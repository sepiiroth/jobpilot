import { Prisma, type PrismaClient } from './index.ts';
import { embeddingProfile } from './collection-repository.ts';
import { scoringKey, resultKey, scoringOfferKey } from './scoring-key.ts';
import { searchInputSchema } from '@jobpilot/shared/profile';
import {
  normalizedJobOfferSchema,
  resumeSchema,
  type LlmAnalysis,
} from '@jobpilot/shared';
import { hardFilter } from '@jobpilot/shared/matching';
import { VectorRepository } from './vector-repository.ts';
export class MatchingRepository {
  constructor(readonly db: PrismaClient) {}
  async context(
    userId: string,
    searchId: string,
    db: PrismaClient | Prisma.TransactionClient = this.db,
  ) {
    const search = await db.search.findFirst({
      where: {
        id: searchId,
        userId,
        isActive: true,
        resume: { isArchived: false },
      },
      include: { resume: true },
    });
    if (!search) return null;
    const settings = await db.userSettings.findUnique({ where: { userId } });
    const criteria = searchInputSchema.parse({
      ...search,
      radiusKm: search.radiusKm ?? undefined,
      salaryMin: search.salaryMin?.toNumber(),
      seniority: search.seniority ?? undefined,
    });
    const profile = embeddingProfile(
      settings?.embeddingProvider ?? 'openai',
      settings?.embeddingModel ?? 'text-embedding-3-small',
      settings?.ollamaBaseUrl,
    );
    const fingerprint = scoringKey(
      criteria,
      search.resume.revision,
      profile,
      settings?.llmProvider ?? 'anthropic',
      settings?.scoringModel ?? 'claude-haiku-5-5',
      settings?.ollamaBaseUrl ?? '',
    );
    return {
      search,
      criteria,
      profile,
      fingerprint,
      resume: resumeSchema.safeParse(search.resume.data),
    };
  }
  async plan(
    userId: string,
    runId: string,
    searchId: string,
    budget: number,
    token: string,
  ) {
    const context = await this.context(userId, searchId);
    if (!context) return null;
    const task = await this.db.scoringTask.upsert({
      where: { runId_searchId: { runId, searchId } },
      create: {
        userId,
        runId,
        searchId,
        budget,
        fingerprint: context.fingerprint,
        attemptedIds: [],
      },
      update: {},
    });
    if (task.status === 'completed') return null;
    const step = await this.db.collectionStep.findFirst({
      where: { userId, runId, searchId },
    });
    if (
      task.fingerprint !== context.fingerprint ||
      !step ||
      JSON.stringify(searchInputSchema.parse(step.criteria)) !==
        JSON.stringify(context.criteria)
    ) {
      await this.db.scoringTask.updateMany({
        where: { id: task.id, userId },
        data: { status: 'obsolete' },
      });
      return null;
    }
    const items = await this.db.collectionItem.findMany({
      where: { userId, runId, step: { searchId } },
      distinct: ['jobOfferId'],
      include: { offer: true },
    });
    const similarities = await new VectorRepository(this.db).offerSimilarities(
      userId,
      context.search.resumeId,
      context.profile,
      items.map((i) => i.jobOfferId),
    );
    const scores = new Map(similarities.map((s) => [s.id, s.similarity]));
    for (const item of items) {
      const offer = normalizedJobOfferSchema.parse({
        ...item.offer,
        salaryMin: item.offer.salaryMin?.toNumber() ?? null,
        salaryMax: item.offer.salaryMax?.toNumber() ?? null,
        publishedAt: item.offer.publishedAt?.toISOString() ?? null,
        fetchedAt: item.offer.fetchedAt.toISOString(),
      });
      const filter = hardFilter(context.criteria, offer),
        key = resultKey(context.fingerprint, scoringOfferKey(offer));
      const existing = await this.db.searchMatch.findUnique({
        where: {
          userId_searchId_jobOfferId: {
            userId,
            searchId,
            jobOfferId: item.jobOfferId,
          },
        },
      });
      const cached = existing?.inputKey === key && existing.state === 'ready';
      const data = {
        runId,
        inputKey: key,
        passed: filter.passed,
        notes: [...filter.reasons, ...filter.warnings],
        similarity: scores.get(item.jobOfferId) ?? null,
        ...(cached
          ? {}
          : {
              state: scores.has(item.jobOfferId) ? 'ranked' : 'waiting',
              llmScore: null,
              llmAnalysis: Prisma.DbNull,
            }),
      };
      await this.db.$transaction(async (tx) => {
        const lease = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM collection_runs WHERE id=${runId}::uuid AND "userId"=${userId}::uuid AND "workerToken"=${token}::uuid AND status='running' AND stage='scoring' FOR SHARE`;
        if (!lease.length) return;
        await tx.$queryRaw`SELECT s.id FROM searches s JOIN resumes r ON r.id=s."resumeId" AND r."userId"=s."userId" WHERE s.id=${searchId}::uuid AND s."userId"=${userId}::uuid FOR SHARE OF s,r`;
        if (
          (await this.context(userId, searchId, tx))?.fingerprint !==
          context.fingerprint
        )
          return;
        await tx.searchMatch.upsert({
          where: {
            userId_searchId_jobOfferId: {
              userId,
              searchId,
              jobOfferId: item.jobOfferId,
            },
          },
          create: { ...data, userId, searchId, jobOfferId: item.jobOfferId },
          update: data,
        });
      });
    }
    const candidates = await this.db.searchMatch.findMany({
      where: {
        userId,
        searchId,
        runId,
        passed: true,
        similarity: { not: null },
        offer: { matches: { some: { userId, status: { not: 'ignored' } } } },
      },
      orderBy: [{ similarity: 'desc' }, { jobOfferId: 'asc' }],
      take: task.budget,
      include: { offer: true },
    });
    return { context, task, candidates };
  }
  async reserve(
    userId: string,
    taskId: string,
    offerId: string,
    runId: string,
    token: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const lease = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM collection_runs WHERE id=${runId}::uuid AND "userId"=${userId}::uuid AND "workerToken"=${token}::uuid AND stage='scoring' AND status='running' FOR SHARE`;
      if (!lease.length) return false;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${taskId},0))`;
      const task = await tx.scoringTask.findFirst({
        where: { id: taskId, userId, runId, status: 'pending' },
      });
      if (
        !task ||
        task.attemptedIds.includes(offerId) ||
        task.attemptedIds.length >= task.budget
      )
        return false;
      await tx.scoringTask.update({
        where: { id: task.id },
        data: { attemptedIds: { push: offerId } },
      });
      return true;
    });
  }
  async result(
    userId: string,
    runId: string,
    token: string,
    searchId: string,
    id: string,
    fingerprint: string,
    inputKey: string,
    contentHash: string,
    analysis: LlmAnalysis | null,
  ) {
    return this.db.$transaction(async (tx) => {
      const lease = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM collection_runs WHERE id=${runId}::uuid AND "userId"=${userId}::uuid AND "workerToken"=${token}::uuid AND status='running' AND stage='scoring' FOR SHARE`;
      if (!lease.length) return;
      await tx.$queryRaw`SELECT s.id FROM searches s JOIN resumes r ON r.id=s."resumeId" AND r."userId"=s."userId" WHERE s.id=${searchId}::uuid AND s."userId"=${userId}::uuid FOR SHARE OF s,r`;
      const fresh = await this.context(userId, searchId, tx);
      if (fresh?.fingerprint !== fingerprint) return;
      const row = await tx.searchMatch.findFirst({
        where: { id, userId },
        include: { offer: true },
      });
      if (!row) return;
      const offer = normalizedJobOfferSchema.parse({
        ...row.offer,
        salaryMin: row.offer.salaryMin?.toNumber() ?? null,
        salaryMax: row.offer.salaryMax?.toNumber() ?? null,
        publishedAt: row.offer.publishedAt?.toISOString() ?? null,
        fetchedAt: row.offer.fetchedAt.toISOString(),
      });
      if (resultKey(fingerprint, scoringOfferKey(offer)) !== inputKey) return;
      await tx.searchMatch.updateMany({
        where: {
          id,
          userId,
          inputKey,
          offer: {
            contentHash,
            matches: { some: { userId, status: { not: 'ignored' } } },
          },
        },
        data: {
          state: analysis ? 'ready' : 'failed',
          llmScore: analysis?.score ?? null,
          llmAnalysis: analysis
            ? (analysis as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
      });
    });
  }
  async aggregate(userId: string, runId: string) {
    const items = await this.db.collectionItem.findMany({
      where: { userId, runId },
      distinct: ['jobOfferId'],
    });
    for (const item of items) {
      const best = await this.db.searchMatch.findFirst({
        where: {
          userId,
          jobOfferId: item.jobOfferId,
          passed: true,
          search: { isActive: true, resume: { isArchived: false } },
        },
        orderBy: [
          { llmScore: { sort: 'desc', nulls: 'last' } },
          { similarity: { sort: 'desc', nulls: 'last' } },
          { id: 'asc' },
        ],
      });
      await this.db.userJobMatch.updateMany({
        where: {
          userId,
          jobOfferId: item.jobOfferId,
          status: { not: 'ignored' },
        },
        data: {
          hardFilterPassed: !!best,
          similarity: best?.similarity ?? null,
          llmScore: best?.llmScore ?? null,
          llmAnalysis: best?.llmAnalysis ?? Prisma.DbNull,
          ...(best ? { searchId: best.searchId } : {}),
        },
      });
    }
  }
}
