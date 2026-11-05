import {
  CollectionRepository,
  MatchingRepository,
  type PrismaClient,
} from '@jobpilot/db';
import { llmAnalysisSchema, normalizedJobOfferSchema } from '@jobpilot/shared';
import { LlmService, jobScoringPrompt } from '@jobpilot/llm';
export class ScoringPipeline {
  constructor(
    private readonly db: PrismaClient,
    private readonly llm: LlmService,
    private readonly budget: number,
  ) {}
  async run(userId: string, runId: string, closing: () => boolean) {
    const collections = new CollectionRepository(this.db),
      repository = new MatchingRepository(this.db);
    const token = await collections.claim(userId, runId, 'scoring');
    if (!token) return;
    const heartbeat = setInterval(async () => {
      try {
        await collections.heartbeat(userId, runId, token);
      } catch {
        /* The next lease check fences writes if connectivity is lost. */
      }
    }, 15000);
    try {
      const steps = await this.db.collectionStep.findMany({
        where: { userId, runId },
        distinct: ['searchId'],
        orderBy: { id: 'asc' },
      });
      for (const step of steps) {
        if (closing()) throw new Error('Worker stopping');
        const plan = await repository.plan(
          userId,
          runId,
          step.searchId,
          this.budget,
          token,
        );
        if (!plan) {
          const obsolete = await this.db.scoringTask.findFirst({
            where: {
              userId,
              runId,
              searchId: step.searchId,
              status: 'obsolete',
            },
          });
          if (obsolete)
            await this.db.collectionStep.updateMany({
              where: { id: step.id, userId },
              data: {
                errors: [
                  ...(Array.isArray(step.errors) ? step.errors : []),
                  { source: 'scoring', code: 'SCORING_STALE' },
                ],
              },
            });
          continue;
        }
        let failed = false;
        for (const candidate of plan.candidates) {
          if (closing()) throw new Error('Worker stopping');
          if (
            (await repository.context(userId, step.searchId))?.fingerprint !==
            plan.context.fingerprint
          ) {
            failed = true;
            break;
          }
          if (candidate.state === 'ready') continue;
          const allowed = await repository.reserve(
            userId,
            plan.task.id,
            candidate.jobOfferId,
            runId,
            token,
          );
          let analysis = null;
          if (allowed && plan.context.resume.success) {
            try {
              const offer = normalizedJobOfferSchema.parse({
                ...candidate.offer,
                salaryMin: candidate.offer.salaryMin?.toNumber() ?? null,
                salaryMax: candidate.offer.salaryMax?.toNumber() ?? null,
                publishedAt: candidate.offer.publishedAt?.toISOString() ?? null,
                fetchedAt: candidate.offer.fetchedAt.toISOString(),
              });
              analysis = await this.llm.generateStructured(
                userId,
                'job_scoring',
                jobScoringPrompt(
                  plan.context.resume.data,
                  offer,
                  plan.context.criteria,
                ),
                llmAnalysisSchema,
                'scoring',
              );
            } catch {
              failed = true;
            }
          } else failed = true;
          await repository.result(
            userId,
            runId,
            token,
            step.searchId,
            candidate.id,
            plan.context.fingerprint,
            candidate.inputKey,
            candidate.offer.contentHash,
            analysis,
          );
        }
        const waiting = await this.db.searchMatch.count({
          where: {
            userId,
            runId,
            searchId: step.searchId,
            passed: true,
            state: 'waiting',
          },
        });
        if (failed || waiting) {
          const fresh = await this.db.collectionStep.findFirst({
            where: { id: step.id, userId },
          });
          await this.db.collectionStep.updateMany({
            where: { id: step.id, userId },
            data: {
              errors: [
                ...(Array.isArray(fresh?.errors) ? fresh.errors : []),
                {
                  source: 'scoring',
                  code: failed ? 'SCORING_FAILED' : 'SCORING_NOT_READY',
                },
              ],
            },
          });
        }
        await this.db.scoringTask.updateMany({
          where: { id: plan.task.id, userId },
          data: { status: 'completed' },
        });
      }
      await repository.aggregate(userId, runId);
      await collections.refresh(userId, runId, true, token);
    } catch {
      await this.db.collectionRun.updateMany({
        where: { id: runId, userId, workerToken: token, status: 'running' },
        data: { status: 'queued' },
      });
      throw new Error('Scoring processing failed');
    } finally {
      clearInterval(heartbeat);
    }
  }
}
