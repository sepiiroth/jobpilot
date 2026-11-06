import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from './index.ts';
import { searchInputSchema } from '@jobpilot/shared/profile';
import {
  collectionRunSchema,
  type CollectionStats,
} from '@jobpilot/shared/collection';
import { computeDedupKey } from '@jobpilot/shared/dedup';
import type { NormalizedJobOffer } from '@jobpilot/shared';
export class CollectionConflict extends Error {
  constructor(readonly code: 'COLLECTION_COOLDOWN' | 'COLLECTION_NO_SEARCHES') {
    super(code);
  }
}
export const embeddingProfile = (
  provider: string,
  model: string,
  baseUrl = '',
) =>
  createHash('sha256')
    .update(
      JSON.stringify([provider, model, provider === 'ollama' ? baseUrl : '']),
    )
    .digest('hex');
export const offerContentHash = (
  offer: Pick<NormalizedJobOffer, 'title' | 'company' | 'description'>,
) =>
  createHash('sha256')
    .update(JSON.stringify([offer.title, offer.company, offer.description]))
    .digest('hex');
const emptyStats = (): CollectionStats => ({
  sourcesTotal: 0,
  sourcesProcessed: 0,
  found: 0,
  new: 0,
  duplicates: 0,
  embeddingsReady: 0,
});
export class CollectionRepository {
  constructor(readonly db: PrismaClient) {}
  start(
    userId: string,
    cooldown: number,
  ): Promise<Prisma.CollectionRunGetPayload<Record<string, never>>>;
  start(
    userId: string,
    cooldown: number,
    trigger: 'scheduled',
    expectedCron: string,
  ): Promise<Prisma.CollectionRunGetPayload<Record<string, never>> | null>;
  async start(
    userId: string,
    cooldown: number,
    trigger: 'manual' | 'scheduled' = 'manual',
    expectedCron?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'collection:' + userId},0))`;
      if (trigger === 'scheduled') {
        const settings = await tx.userSettings.findUnique({
          where: { userId },
        });
        if (
          !settings?.collectionCron ||
          settings.collectionCron !== expectedCron
        )
          return null;
      }
      const active = await tx.collectionRun.findFirst({
        where: { userId, status: { in: ['queued', 'running'] } },
      });
      if (active) return active;
      const latest = await tx.collectionRun.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      const settings = await tx.userSettings.findUnique({ where: { userId } });
      if (
        latest &&
        Date.now() - latest.createdAt.getTime() <
          (settings?.collectionCooldownMin ?? cooldown) * 60000
      )
        throw new CollectionConflict('COLLECTION_COOLDOWN');
      const searches = await tx.search.findMany({
        where: { userId, isActive: true, resume: { isArchived: false } },
        orderBy: { id: 'asc' },
      });
      if (!searches.length)
        throw new CollectionConflict('COLLECTION_NO_SEARCHES');
      const run = await tx.collectionRun.create({
        data: { userId, trigger, stats: emptyStats() },
      });
      const steps = searches.flatMap((search) => {
        const criteria = searchInputSchema.parse({
          ...search,
          radiusKm: search.radiusKm ?? undefined,
          salaryMin: search.salaryMin?.toNumber(),
          seniority: search.seniority ?? undefined,
        });
        return criteria.sources.map((source) => ({
          userId,
          runId: run.id,
          searchId: search.id,
          source,
          criteria: criteria as Prisma.InputJsonValue,
        }));
      });
      await tx.collectionStep.createMany({ data: steps });
      await tx.collectionRun.update({
        where: { id: run.id },
        data: { stats: { ...emptyStats(), sourcesTotal: steps.length } },
      });
      return tx.collectionRun.findUniqueOrThrow({ where: { id: run.id } });
    });
  }
  async latest(userId: string) {
    const run = await this.db.collectionRun.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return run ? this.serialize(run) : null;
  }
  async get(userId: string, id: string) {
    const run = await this.db.collectionRun.findFirst({
      where: { userId, id },
    });
    return run ? this.serialize(run) : null;
  }
  serialize(
    run: Awaited<ReturnType<PrismaClient['collectionRun']['findFirstOrThrow']>>,
  ) {
    return collectionRunSchema.parse({
      ...run,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    });
  }
  async claim(userId: string, id: string, stage = 'collection') {
    const token = randomUUID();
    const rows = await this.db.$queryRaw<
      Array<{ id: string }>
    >`UPDATE collection_runs SET status='running', "startedAt"=COALESCE("startedAt",now()), "heartbeatAt"=now(), "workerToken"=${token}::uuid WHERE id=${id}::uuid AND "userId"=${userId}::uuid AND stage=${stage} AND (status='queued' OR (status='running' AND "heartbeatAt"<now()-interval '2 minutes')) RETURNING id`;
    return rows.length ? token : null;
  }
  heartbeat(userId: string, id: string, token: string) {
    return this.db.collectionRun.updateMany({
      where: { userId, id, workerToken: token, status: 'running' },
      data: { heartbeatAt: new Date() },
    });
  }
  async countCurrentEmbeddings(
    userId: string,
    runId: string,
    statuses: string[],
  ) {
    const settings = await this.db.userSettings.findUnique({
      where: { userId },
    });
    const profile = embeddingProfile(
      settings?.embeddingProvider ?? 'openai',
      settings?.embeddingModel ?? 'text-embedding-3-small',
      settings?.ollamaBaseUrl,
    );
    const rows = await this.db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM offer_embeddings e JOIN job_offers j ON j.id=e."jobOfferId" WHERE e."userId"=${userId}::uuid AND e."profileKey"=${profile} AND e."contentHash"=j."contentHash" AND e.status=ANY(${statuses}::text[]) AND EXISTS (SELECT 1 FROM collection_items i WHERE i."jobOfferId"=j.id AND i."userId"=${userId}::uuid AND i."runId"=${runId}::uuid)`;
    return Number(rows[0]?.count ?? 0);
  }
  async refresh(userId: string, id: string, finish = false, token?: string) {
    const steps = await this.db.collectionStep.findMany({
      where: { userId, runId: id },
    });
    const errors = steps
      .flatMap((s) => (Array.isArray(s.errors) ? s.errors : []))
      .slice(0, 100);
    const [found, fresh, ready] = await Promise.all([
      this.db.collectionItem.count({ where: { userId, runId: id } }),
      this.db.collectionItem.count({
        where: { userId, runId: id, isNew: true },
      }),
      this.countCurrentEmbeddings(userId, id, ['ready']),
    ]);
    const stats = {
      sourcesTotal: steps.length,
      sourcesProcessed: steps.filter((s) =>
        ['completed', 'failed'].includes(s.status),
      ).length,
      found,
      new: fresh,
      duplicates: found - fresh,
      embeddingsReady: ready,
    };
    return this.db.collectionRun.updateMany({
      where: {
        userId,
        id,
        ...(token ? { workerToken: token } : {}),
        status: { in: ['queued', 'running'] },
      },
      data: {
        stats,
        errors,
        ...(finish
          ? {
              status: errors.length ? 'completed_with_errors' : 'completed',
              finishedAt: new Date(),
            }
          : {}),
      },
    });
  }
  async store(
    userId: string,
    runId: string,
    stepId: string,
    token: string,
    offer: NormalizedJobOffer,
  ) {
    return this.db.$transaction(async (tx) => {
      const run = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM collection_runs WHERE id=${runId}::uuid AND "userId"=${userId}::uuid AND "workerToken"=${token}::uuid AND status='running' FOR SHARE`;
      if (!run.length) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'external:' + offer.sourceId + ':' + offer.externalId},0))`;
      const step = await tx.collectionStep.findFirst({
        where: { userId, id: stepId, runId },
      });
      if (
        !step ||
        !(await tx.search.findFirst({ where: { userId, id: step.searchId } }))
      )
        return null;
      const seen = await tx.collectionItem.findUnique({
        where: { stepId_externalId: { stepId, externalId: offer.externalId } },
      });
      if (seen) return seen.jobOfferId;
      const privateUserId = offer.sourceId === 'email' ? userId : null;
      const dedupKey = computeDedupKey(
        offer.title,
        offer.company,
        offer.location.city,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'offer:' + (privateUserId ?? 'public') + ':' + dedupKey},0))`;
      const alias = await tx.jobOfferAlias.findUnique({
        where: {
          sourceId_externalId: {
            sourceId: offer.sourceId,
            externalId: offer.externalId,
          },
        },
      });
      let existing = alias
        ? await tx.jobOffer.findFirst({
            where: { id: alias.jobOfferId, privateUserId },
          })
        : await tx.jobOffer.findFirst({
            where: {
              privateUserId,
              OR: [
                { sourceId: offer.sourceId, externalId: offer.externalId },
                {
                  dedupKey,
                  fetchedAt: { gte: new Date(Date.now() - 30 * 86400000) },
                },
              ],
            },
            orderBy: { id: 'asc' },
          });
      if (alias && !existing) throw new Error('Source identity collision');
      const contentHash = offerContentHash(offer);
      if (!existing)
        existing = await tx.jobOffer.create({
          data: {
            ...offer,
            privateUserId,
            location: offer.location as Prisma.InputJsonValue,
            publishedAt: offer.publishedAt ? new Date(offer.publishedAt) : null,
            fetchedAt: new Date(),
            dedupKey,
            contentHash,
            alternateUrls: [],
          },
        });
      else if (
        existing.sourceId === offer.sourceId &&
        existing.externalId === offer.externalId
      )
        existing = await tx.jobOffer.update({
          where: { id: existing.id },
          data: {
            ...offer,
            location: offer.location as Prisma.InputJsonValue,
            publishedAt: offer.publishedAt ? new Date(offer.publishedAt) : null,
            fetchedAt: new Date(),
            dedupKey,
            contentHash,
          },
        });
      else if (
        existing.url !== offer.url &&
        !existing.alternateUrls.includes(offer.url)
      )
        existing = await tx.jobOffer.update({
          where: { id: existing.id },
          data: { alternateUrls: { push: offer.url }, fetchedAt: new Date() },
        });
      await tx.jobOfferAlias.upsert({
        where: {
          sourceId_externalId: {
            sourceId: offer.sourceId,
            externalId: offer.externalId,
          },
        },
        create: {
          sourceId: offer.sourceId,
          externalId: offer.externalId,
          jobOfferId: existing.id,
        },
        update: {},
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'offer-status:' + userId + ':' + dedupKey},0))`;
      const preservedMatch = await tx.userJobMatch.findFirst({
        where: {
          userId,
          status: { in: ['ignored', 'applied'] },
          jobOffer: {
            OR: [
              {
                dedupKey,
                fetchedAt: { gte: new Date(Date.now() - 30 * 86400000) },
              },
              { url: offer.url },
            ],
          },
        },
      });
      const created = await tx.userJobMatch.createMany({
        data: {
          userId,
          jobOfferId: existing.id,
          searchId: step.searchId,
          hardFilterPassed: false,
          status: preservedMatch?.status ?? 'new',
        },
        skipDuplicates: true,
      });
      await tx.collectionItem.create({
        data: {
          userId,
          runId,
          stepId,
          externalId: offer.externalId,
          jobOfferId: existing.id,
          isNew: created.count > 0,
        },
      });
      return existing.id;
    });
  }
}
