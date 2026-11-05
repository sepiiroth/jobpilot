import type { PrismaClient } from '@jobpilot/db';
export class UsersRepository {
  private readonly db: PrismaClient;
  constructor(db: PrismaClient) {
    this.db = db;
  }
  async export(userId: string) {
    return this.db.$transaction(
      async (tx) => {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { id: true, email: true, locale: true, createdAt: true },
        });
        const [
          resumes,
          searches,
          trackedCompanies,
          matches,
          collections,
          documents,
          applications,
          usage,
          audit,
          settings,
          sessions,
          secrets,
          collectionSteps,
          collectionItems,
          offerEmbeddings,
          searchMatches,
          scoringTasks,
          offers,
        ] = await Promise.all([
          tx.resume.findMany({ where: { userId } }),
          tx.search.findMany({ where: { userId } }),
          tx.trackedCompany.findMany({ where: { userId } }),
          tx.userJobMatch.findMany({ where: { userId } }),
          tx.collectionRun.findMany({ where: { userId } }),
          tx.generatedDocument.findMany({ where: { userId } }),
          tx.application.findMany({ where: { userId } }),
          tx.llmUsage.findMany({ where: { userId } }),
          tx.auditLog.findMany({ where: { userId } }),
          tx.userSettings.findUnique({ where: { userId } }),
          tx.session.findMany({
            where: { userId },
            select: {
              id: true,
              createdAt: true,
              expiresAt: true,
              lastSeenAt: true,
              ip: true,
              userAgent: true,
            },
          }),
          tx.userSecret.findMany({
            where: { userId },
            select: { id: true, kind: true, keyVersion: true, createdAt: true },
          }),
          tx.collectionStep.findMany({ where: { userId } }),
          tx.collectionItem.findMany({ where: { userId } }),
          tx.offerEmbedding.findMany({ where: { userId } }),
          tx.searchMatch.findMany({ where: { userId } }),
          tx.scoringTask.findMany({ where: { userId } }),
          tx.jobOffer.findMany({
            where: {
              OR: [
                { matches: { some: { userId } } },
                { documents: { some: { userId } } },
                { applications: { some: { userId } } },
              ],
            },
          }),
        ]);
        return {
          schemaVersion: 3,
          exportedAt: new Date().toISOString(),
          user,
          resumes,
          searches,
          trackedCompanies,
          matches,
          collections,
          documents,
          applications,
          usage,
          audit,
          settings,
          sessions,
          secrets,
          offers,
          collectionSteps,
          collectionItems,
          offerEmbeddings,
          searchMatches,
          scoringTasks,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  delete(userId: string) {
    return this.db.user.delete({ where: { id: userId } });
  }
}
