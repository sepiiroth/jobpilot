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
    status: 'new' | 'interesting' | 'ignored',
  ) {
    const row = await this.db.searchMatch.findFirst({
      where: { id, userId, passed: true },
    });
    if (!row) return null;
    const updated = await this.db.userJobMatch.updateMany({
      where: { userId, jobOfferId: row.jobOfferId },
      data: { status },
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
