import { ApiError } from '../common/errors.ts';
import { Prisma, type PrismaClient } from '@jobpilot/db';
import { jobRecordSchema, type JobQuery } from '@jobpilot/shared/jobs';
const includeFor = (userId: string) => ({
  search: true,
  offer: {
    include: { matches: { where: { userId }, select: { status: true } } },
  },
});
type RecordRow = Prisma.SearchMatchGetPayload<{
  include: ReturnType<typeof includeFor>;
}>;
export class JobsRepository {
  constructor(private readonly db: PrismaClient) {}
  private serialize(row: RecordRow) {
    return jobRecordSchema.parse({
      id: row.id,
      offerId: row.jobOfferId,
      searchId: row.searchId,
      searchName: row.search.name,
      title: row.offer.title,
      company: row.offer.company,
      source: row.offer.sourceId,
      url: row.offer.url,
      alternateUrls: row.offer.alternateUrls,
      location: row.offer.location,
      remote: row.offer.remote,
      contractType: row.offer.contractType,
      salaryMin: row.offer.salaryMin?.toNumber() ?? null,
      salaryMax: row.offer.salaryMax?.toNumber() ?? null,
      salaryCurrency: row.offer.salaryCurrency,
      publishedAt: row.offer.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      status: row.offer.matches[0]?.status ?? 'new',
      similarity: row.similarity,
      score: row.llmScore,
      analysis: row.llmAnalysis,
      state: row.state,
      notes: row.notes,
      description: row.offer.description,
    });
  }
  async list(userId: string, query: JobQuery) {
    const where: Prisma.SearchMatchWhereInput = {
      userId,
      passed: true,
      search: { isActive: true, resume: { isArchived: false } },
      ...(query.searchId ? { searchId: query.searchId } : {}),
      ...(query.minScore !== undefined
        ? { llmScore: { gte: query.minScore } }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to
                ? { lt: new Date(new Date(query.to).getTime() + 86400000) }
                : {}),
            },
          }
        : {}),
      offer: {
        matches: {
          some: { userId, status: query.status ?? { not: 'ignored' } },
        },
        ...(query.source
          ? {
              OR: [
                { sourceId: query.source },
                { aliases: { some: { sourceId: query.source } } },
              ],
            }
          : {}),
      },
    };
    const [rows, total] = await this.db.$transaction([
      this.db.searchMatch.findMany({
        where,
        include: includeFor(userId),
        orderBy: [
          { llmScore: { sort: 'desc', nulls: 'last' } },
          { similarity: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
        take: 20,
        skip: (query.page - 1) * 20,
      }),
      this.db.searchMatch.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.serialize(r)),
      total,
      page: query.page,
      pageSize: 20,
    };
  }
  async get(userId: string, id: string) {
    const row = await this.db.searchMatch.findFirst({
      where: {
        id,
        userId,
        passed: true,
        offer: { matches: { some: { userId } } },
      },
      include: includeFor(userId),
    });
    return row ? this.serialize(row) : null;
  }
  async status(
    userId: string,
    id: string,
    status: 'new' | 'interesting' | 'ignored' | 'applied',
    appliedAt?: string,
  ) {
    const row = await this.db.searchMatch.findFirst({
      where: { id, userId, passed: true },
      include: { offer: true },
    });
    if (!row) return null;
    const updated = await this.db.$transaction(async (tx) => {
      if (status === 'applied')
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'applications:' + userId},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'offer-status:' + userId + ':' + row.offer.dedupKey},0))`;
      if (status === 'applied') {
        const existing = await tx.application.findFirst({
          where: {
            userId,
            jobOffer: {
              OR: [
                { id: row.jobOfferId },
                {
                  dedupKey: row.offer.dedupKey,
                  fetchedAt: { gte: new Date(Date.now() - 30 * 86400000) },
                },
                { url: row.offer.url },
              ],
            },
          },
        });
        if (!existing)
          await tx.application.create({
            data: {
              userId,
              jobOfferId: row.jobOfferId,
              status: 'applied',
              appliedAt: appliedAt
                ? new Date(appliedAt + 'T00:00:00Z')
                : new Date(),
            },
          });
        else if (existing.status === 'to_apply')
          await tx.application.update({
            where: { id: existing.id, userId },
            data: {
              status: 'applied',
              appliedAt:
                existing.appliedAt ??
                (appliedAt ? new Date(appliedAt + 'T00:00:00Z') : new Date()),
              revision: { increment: 1 },
            },
          });
      }
      const flags = await tx.userJobMatch.updateMany({
        where: {
          userId,
          OR: [
            { jobOfferId: row.jobOfferId },
            {
              jobOffer: {
                dedupKey: row.offer.dedupKey,
                fetchedAt: { gte: new Date(Date.now() - 30 * 86400000) },
              },
            },
            { jobOffer: { url: row.offer.url } },
          ],
        },
        data: { status },
      });
      if (!flags.count) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
      return flags;
    });
    return updated.count ? this.get(userId, id) : null;
  }
  async summary(userId: string) {
    const latest = await this.db.collectionRun.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest)
      return { newOffers: 0, matchedOffers: 0, analyzed: 0, best: [] };
    const rows = await this.db.searchMatch.findMany({
      where: {
        userId,
        runId: latest.id,
        passed: true,
        search: { isActive: true, resume: { isArchived: false } },
        offer: { matches: { some: { userId, status: { not: 'ignored' } } } },
      },
      include: includeFor(userId),
      orderBy: [
        { llmScore: { sort: 'desc', nulls: 'last' } },
        { similarity: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
    });
    const fresh = await this.db.collectionItem.findMany({
      where: { userId, runId: latest.id, isNew: true },
      distinct: ['jobOfferId'],
    });
    const ids = new Set(rows.map((r) => r.jobOfferId)),
      unique = rows.filter(
        (r, i) => rows.findIndex((o) => o.jobOfferId === r.jobOfferId) === i,
      );
    return {
      newOffers: fresh.filter((i) => ids.has(i.jobOfferId)).length,
      matchedOffers: unique.length,
      analyzed: new Set(
        rows.filter((r) => r.state === 'ready').map((r) => r.jobOfferId),
      ).size,
      best: unique
        .filter((r) => r.llmScore !== null || r.similarity !== null)
        .slice(0, 5)
        .map((r) => this.serialize(r)),
    };
  }
}
