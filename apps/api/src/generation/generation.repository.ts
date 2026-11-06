import { Prisma, type PrismaClient } from '@jobpilot/db';
import { resumeSchema } from '@jobpilot/shared';
import {
  documentContentSchema,
  generationParamsSchema,
  generationCostSchema,
  type DocumentContent,
  type GenerationCost,
  type GenerationParams,
} from '@jobpilot/shared/generation';
import { fingerprint, checkIntegrity } from '@jobpilot/llm';
import { ApiError } from '../common/errors.ts';
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export class GenerationRepository {
  constructor(private readonly db: PrismaClient) {}
  async context(userId: string, matchId: string, resumeId: string) {
    const [match, resume] = await Promise.all([
      this.db.searchMatch.findFirst({
        where: {
          id: matchId,
          userId,
          passed: true,
          offer: { OR: [{ privateUserId: null }, { privateUserId: userId }] },
        },
        include: { offer: true },
      }),
      this.db.resume.findFirst({
        where: { id: resumeId, userId, isArchived: false },
      }),
    ]);
    if (!match || !resume)
      throw new ApiError(404, 'NOT_FOUND', 'Document context not found');
    return { offer: match.offer, master: resumeSchema.parse(resume.data) };
  }
  async find(userId: string, id: string) {
    const row = await this.db.generatedDocument.findFirst({
      where: { id, userId },
      include: { resume: true },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    return row;
  }
  async list(userId: string, matchId: string, cursor?: string) {
    const match = await this.db.searchMatch.findFirst({
      where: { id: matchId, userId, passed: true },
    });
    if (!match) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    const rows = await this.db.generatedDocument.findMany({
      where: {
        userId,
        jobOfferId: match.jobOfferId,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: { resume: true },
      orderBy: { id: 'desc' },
      take: 51,
    });
    return {
      items: rows.slice(0, 50).map((row) => this.serialize(row)),
      nextCursor: rows.length > 50 ? rows[49]!.id : null,
    };
  }
  serialize(row: Awaited<ReturnType<GenerationRepository['find']>>) {
    const content = documentContentSchema.parse(row.content);
    const master = resumeSchema.parse(row.resume.data);
    const sourceFingerprint = fingerprint(master);
    const metadata = row.params as Record<string, unknown>;
    const report = row.integrityReport as Record<string, unknown> | null;
    const issues = checkIntegrity(master, content);
    const approved =
      report?.approvedFingerprint === sourceFingerprint &&
      report?.contentFingerprint === fingerprint(content);
    const sourceChanged =
      report?.generatedSourceFingerprint !== sourceFingerprint;
    return {
      id: row.id,
      jobOfferId: row.jobOfferId,
      resumeId: row.resumeId,
      kind: content.kind,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      content,
      params: generationParamsSchema.parse(metadata.options),
      cost: generationCostSchema.parse(metadata.cost),
      sourceFingerprint,
      integrity: {
        issues,
        approved,
        sourceChanged,
        blocked: (issues.length > 0 || sourceChanged) && !approved,
      },
    };
  }
  async append(
    userId: string,
    jobOfferId: string,
    resumeId: string,
    content: DocumentContent,
    options: GenerationParams,
    cost: GenerationCost,
    sourceFingerprint: string,
  ) {
    return this.db.$transaction(async (tx) => {
      // Serialize version allocation across concurrent requests and kinds.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'documents:' + userId + ':' + jobOfferId + ':' + resumeId},0))`;
      const latest = await tx.generatedDocument.findFirst({
        where: { userId, jobOfferId, resumeId, kind: content.kind },
        orderBy: { version: 'desc' },
      });
      return tx.generatedDocument.create({
        data: {
          userId,
          jobOfferId,
          resumeId,
          kind: content.kind,
          version: (latest?.version ?? 0) + 1,
          content: json(content),
          params: json({ options, cost }),
          integrityReport: json({
            generatedSourceFingerprint: sourceFingerprint,
          }),
          model: cost.model,
          tokensIn: cost.tokensIn,
          tokensOut: cost.tokensOut,
        },
        include: { resume: true },
      });
    });
  }
  async approve(
    userId: string,
    id: string,
    sourceFingerprint: string,
    issueIds: string[],
  ) {
    return this.db.$transaction(async (tx) => {
      const row = await tx.generatedDocument.findFirst({
        where: { id, userId },
        include: { resume: true },
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Document not found');
      // Lock the master while checking its revision; a later edit invalidates approval again.
      await tx.$queryRaw`SELECT id FROM resumes WHERE id=${row.resumeId}::uuid AND "userId"=${userId}::uuid FOR SHARE`;
      const current = await tx.generatedDocument.findFirstOrThrow({
        where: { id, userId },
        include: { resume: true },
      });
      const value = this.serialize(current);
      if (sourceFingerprint !== value.sourceFingerprint)
        throw new ApiError(409, 'SOURCE_CHANGED', 'Master resume changed');
      const expected = value.integrity.issues.map((i) => i.id).sort();
      if (
        JSON.stringify([...new Set(issueIds)].sort()) !==
        JSON.stringify(expected)
      )
        throw new ApiError(
          409,
          'INTEGRITY_REVIEW_REQUIRED',
          'Review every current issue',
        );
      return tx.generatedDocument.update({
        where: { id, userId },
        data: {
          integrityReport: json({
            generatedSourceFingerprint: (
              current.integrityReport as Record<string, unknown>
            ).generatedSourceFingerprint,
            approvedFingerprint: sourceFingerprint,
            contentFingerprint: fingerprint(value.content),
            reviewedAt: new Date().toISOString(),
          }),
        },
        include: { resume: true },
      });
    });
  }
}
