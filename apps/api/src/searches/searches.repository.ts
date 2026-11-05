import type { PrismaClient, Prisma } from '@jobpilot/db';
import type { SearchInput } from '@jobpilot/shared/profile';
export class SearchesRepository {
  constructor(private readonly db: PrismaClient) {}
  list(userId: string) {
    return this.db.search.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
  find(userId: string, id: string) {
    return this.db.search.findFirst({ where: { userId, id } });
  }
  async save(userId: string, id: string | undefined, input: SearchInput) {
    return this.db.$transaction(async (tx) => {
      if (
        !(await tx.resume.findFirst({
          where: { userId, id: input.resumeId, isArchived: false },
        }))
      )
        return null;
      const data = {
        ...input,
        radiusKm: input.radiusKm ?? null,
        salaryMin: input.salaryMin ?? null,
        seniority: input.seniority ?? null,
        locations: input.locations as Prisma.InputJsonValue,
      };
      if (!id) return tx.search.create({ data: { ...data, userId } });
      if (!(await tx.search.updateMany({ where: { userId, id }, data })).count)
        return null;
      await tx.searchMatch.deleteMany({ where: { userId, searchId: id } });
      return tx.search.findFirst({ where: { userId, id } });
    });
  }
  async delete(userId: string, id: string) {
    return (await this.db.search.deleteMany({ where: { userId, id } })).count;
  }
}
