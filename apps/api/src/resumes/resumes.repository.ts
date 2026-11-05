import type { PrismaClient, Prisma } from '@jobpilot/db';
import type { ResumeInput } from '@jobpilot/shared/profile';
export class ResumesRepository {
  constructor(private readonly db: PrismaClient) {}
  list(userId: string) {
    return this.db.resume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
  find(userId: string, id: string) {
    return this.db.resume.findFirst({ where: { userId, id } });
  }
  create(userId: string, input: ResumeInput) {
    return this.db.resume.create({
      data: { ...input, data: input.data as Prisma.InputJsonValue, userId },
    });
  }
  update(userId: string, id: string, input: ResumeInput) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.resume.updateMany({
        where: { userId, id },
        data: {
          ...input,
          data: input.data as Prisma.InputJsonValue,
          revision: { increment: 1 },
          embeddingStatus: 'pending',
          embeddingProvider: null,
          embeddingModel: null,
        },
      });
      if (!result.count) return null;
      // Stored vectors must never survive an edit to their source text.
      await tx.$executeRaw`UPDATE resumes SET embedding = NULL WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid`;
      return tx.resume.findFirst({ where: { userId, id } });
    });
  }
  async delete(userId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      if (
        (await tx.search.count({ where: { userId, resumeId: id } })) ||
        (await tx.generatedDocument.count({ where: { userId, resumeId: id } }))
      )
        return 'in_use' as const;
      return (await tx.resume.deleteMany({ where: { userId, id } })).count
        ? ('deleted' as const)
        : ('missing' as const);
    });
  }
}
