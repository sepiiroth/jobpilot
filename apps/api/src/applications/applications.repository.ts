import { applicationRecordSchema } from '@jobpilot/shared/applications';
import { type Prisma, type PrismaClient } from '@jobpilot/db';
import type {
  ApplicationFields,
  ApplicationStatus,
} from '@jobpilot/shared/applications';
import { GenerationRepository } from '../generation/generation.repository.ts';
import { ApiError } from '../common/errors.ts';
function relatedOffer(offer: {
  id: string;
  dedupKey: string;
  url: string;
}): Prisma.JobOfferWhereInput {
  return {
    OR: [
      { id: offer.id },
      {
        dedupKey: offer.dedupKey,
        fetchedAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
      { url: offer.url },
    ],
  };
}
const include = { jobOffer: true } as const;
type Row = Prisma.ApplicationGetPayload<{ include: typeof include }>;
export class ApplicationsRepository {
  constructor(private readonly db: PrismaClient) {}
  private async serialize(
    userId: string,
    row: Row,
    client: Pick<Prisma.TransactionClient, 'searchMatch'> = this.db,
  ) {
    const match = await client.searchMatch.findFirst({
      where: { userId, jobOfferId: row.jobOfferId, passed: true },
      select: { id: true },
      orderBy: { id: 'desc' },
    });
    return applicationRecordSchema.parse({
      id: row.id,
      jobOfferId: row.jobOfferId,
      matchId: match?.id ?? null,
      title: row.jobOffer.title,
      company: row.jobOffer.company,
      url: row.jobOffer.url,
      description: row.jobOffer.description,
      status: row.status,
      appliedAt: row.appliedAt?.toISOString().slice(0, 10) ?? null,
      followUpAt: row.followUpAt?.toISOString().slice(0, 10) ?? null,
      notes: row.notes,
      resumeDocId: row.resumeDocId,
      letterDocId: row.letterDocId,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
    });
  }
  async list(userId: string, cursor?: string) {
    const rows = await this.db.application.findMany({
      where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) },
      include,
      orderBy: { id: 'desc' },
      take: 51,
    });
    return {
      items: await Promise.all(
        rows.slice(0, 50).map((row) => this.serialize(userId, row)),
      ),
      nextCursor: rows.length > 50 ? rows[49]!.id : null,
    };
  }
  async get(userId: string, id: string) {
    const row = await this.db.application.findFirst({
      where: { id, userId },
      include,
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Application not found');
    return this.serialize(userId, row);
  }
  async documents(userId: string, id: string, cursor?: string) {
    const application = await this.db.application.findFirst({
      where: { id, userId },
      include,
    });
    if (!application)
      throw new ApiError(404, 'NOT_FOUND', 'Application not found');
    const rows = await this.db.generatedDocument.findMany({
      where: {
        userId,
        jobOffer: relatedOffer(application.jobOffer),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: { resume: true },
      orderBy: { id: 'desc' },
      take: 51,
    });
    const generation = new GenerationRepository(this.db);
    return {
      items: rows.slice(0, 50).map((row) => ({
        id: row.id,
        kind: row.kind,
        version: row.version,
        resumeTitle: row.resume.title,
        blocked: generation.serialize(row).integrity.blocked,
      })),
      nextCursor: rows.length > 50 ? rows[49]!.id : null,
    };
  }
  async create(
    userId: string,
    matchId: string,
    status: ApplicationStatus,
    appliedAt: string | null,
  ) {
    const match = await this.db.searchMatch.findFirst({
      where: {
        id: matchId,
        userId,
        passed: true,
        offer: { OR: [{ privateUserId: null }, { privateUserId: userId }] },
      },
      include: { offer: true },
    });
    if (!match) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    const row = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'applications:' + userId},0))`;
      const existing = await tx.application.findFirst({
        where: { userId, jobOffer: relatedOffer(match.offer) },
        include,
      });
      if (existing) return existing;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'offer-status:' + userId + ':' + match.offer.dedupKey},0))`;
      const value = await tx.application.upsert({
        where: { userId_jobOfferId: { userId, jobOfferId: match.jobOfferId } },
        create: {
          userId,
          jobOfferId: match.jobOfferId,
          status,
          appliedAt: appliedAt
            ? new Date(appliedAt + 'T00:00:00Z')
            : status === 'to_apply'
              ? null
              : new Date(),
        },
        update: {},
        include,
      });
      await this.sync(tx, userId, value);
      return value;
    });
    return this.serialize(userId, row);
  }
  private sync(tx: Prisma.TransactionClient, userId: string, row: Row) {
    return tx.userJobMatch.updateMany({
      where: {
        userId,
        OR: [
          { jobOfferId: row.jobOfferId },
          {
            jobOffer: {
              dedupKey: row.jobOffer.dedupKey,
              fetchedAt: { gte: new Date(Date.now() - 30 * 86400000) },
            },
          },
          { jobOffer: { url: row.jobOffer.url } },
        ],
      },
      data: { status: row.appliedAt ? 'applied' : 'interesting' },
    });
  }
  async update(
    userId: string,
    id: string,
    revision: number,
    fields: ApplicationFields,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'applications:' + userId},0))`;
      const row = await tx.application.findFirst({
        where: { id, userId },
        include,
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Application not found');
      if (row.revision !== revision)
        throw new ApiError(
          409,
          'APPLICATION_CHANGED',
          'Application changed; reload before saving',
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'offer-status:' + userId + ':' + row.jobOffer.dedupKey},0))`;
      for (const [kind, documentId, previous] of [
        ['resume', fields.resumeDocId, row.resumeDocId],
        ['cover_letter', fields.letterDocId, row.letterDocId],
      ] as const) {
        if (!documentId) continue;
        const document = await tx.generatedDocument.findFirst({
          where: {
            id: documentId,
            userId,
            jobOffer: relatedOffer(row.jobOffer),
            kind,
          },
          include: { resume: true },
        });
        if (!document)
          throw new ApiError(404, 'NOT_FOUND', 'Document not found');
        if (
          previous !== documentId &&
          new GenerationRepository(this.db).serialize(document).integrity
            .blocked
        )
          throw new ApiError(
            409,
            'DOCUMENT_REVIEW_REQUIRED',
            'Review document before attaching it',
          );
      }
      const updated = await tx.application.updateMany({
        where: { id, userId, revision },
        data: {
          ...fields,
          appliedAt: fields.appliedAt
            ? new Date(fields.appliedAt + 'T00:00:00Z')
            : null,
          followUpAt: fields.followUpAt
            ? new Date(fields.followUpAt + 'T00:00:00Z')
            : null,
          revision: { increment: 1 },
        },
      });
      if (!updated.count)
        throw new ApiError(
          409,
          'APPLICATION_CHANGED',
          'Application changed; reload before saving',
        );
      const saved = await tx.application.findFirstOrThrow({
        where: { id, userId },
        include,
      });
      if (
        row.status !== fields.status ||
        (row.appliedAt?.toISOString().slice(0, 10) ?? null) !== fields.appliedAt
      )
        await this.sync(tx, userId, saved);
      return this.serialize(userId, saved, tx);
    });
  }
  async move(
    userId: string,
    id: string,
    revision: number,
    status: ApplicationStatus,
    appliedAt?: string,
  ) {
    const current = await this.get(userId, id);
    return this.update(userId, id, revision, {
      status,
      appliedAt:
        current.appliedAt ??
        (status === 'to_apply'
          ? null
          : (appliedAt ?? new Date().toISOString().slice(0, 10))),
      followUpAt: current.followUpAt,
      notes: current.notes,
      resumeDocId: current.resumeDocId,
      letterDocId: current.letterDocId,
    });
  }
}
