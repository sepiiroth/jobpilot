import { LlmService } from '@jobpilot/llm';
import type { PrismaClient } from '@jobpilot/db';
import { resumeSchema } from '@jobpilot/shared';
export class ResumeEmbeddings {
  private readonly rerun = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  constructor(
    private readonly db: PrismaClient,
    private readonly llm: LlmService,
  ) {}
  async refresh(userId: string, id: string) {
    const resume = await this.db.resume.findFirst({ where: { userId, id } });
    if (!resume) return;
    const data = resumeSchema.safeParse(resume.data);
    if (!data.success) return;
    try {
      // Only professional content is sent; contact details are not useful for matching.
      const text = JSON.stringify({
        label: data.data.basics.label,
        summary: data.data.basics.summary,
        work: data.data.work,
        education: data.data.education,
        skills: data.data.skills,
        languages: data.data.languages,
        projects: data.data.projects,
      });
      const result = await this.llm.embed(userId, text);
      await this.db
        .$executeRaw`UPDATE resumes SET embedding = ${JSON.stringify(result.embedding)}::vector, "embeddingStatus" = 'ready', "embeddingProvider" = ${result.provider}, "embeddingModel" = ${result.model} WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid AND revision = ${resume.revision} AND EXISTS (SELECT 1 FROM user_settings s WHERE s."userId" = ${userId}::uuid AND s."embeddingProvider" = ${result.provider} AND s."embeddingModel" = ${result.model})`;
    } catch (error) {
      const status =
        error instanceof Error && error.message === 'LLM_NOT_CONFIGURED'
          ? 'not_configured'
          : 'failed';
      await this.db.resume.updateMany({
        where: { userId, id, revision: resume.revision },
        data: { embeddingStatus: status },
      });
    }
  }
  schedule(userId: string) {
    if (this.running.has(userId)) {
      this.rerun.add(userId);
      return;
    }
    const task = (async () => {
      const resumes = await this.db.resume.findMany({
        where: { userId, isArchived: false, embeddingStatus: { not: 'ready' } },
        select: { id: true },
      });
      for (const resume of resumes) await this.refresh(userId, resume.id);
    })()
      .catch(() => {})
      .finally(() => {
        this.running.delete(userId);
        if (this.rerun.delete(userId)) this.schedule(userId);
      });
    this.running.set(userId, task);
  }
  async invalidate(userId: string) {
    await this.db
      .$executeRaw`UPDATE resumes SET embedding = NULL, "embeddingStatus" = 'pending', "embeddingProvider" = NULL, "embeddingModel" = NULL, revision = revision + 1 WHERE "userId" = ${userId}::uuid`;
  }
  async onApplicationShutdown() {
    await Promise.allSettled(this.running.values());
  }
}
