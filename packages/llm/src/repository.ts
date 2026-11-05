import type { PrismaClient } from '@jobpilot/db';
import { profileSettingsSchema } from '@jobpilot/shared/profile';
import type { LlmEnvironment } from './config.ts';
import { LlmError } from './errors.ts';
export class LlmRepository {
  constructor(private readonly db: PrismaClient) {}
  async settings(userId: string, config: LlmEnvironment) {
    const value = await this.db.userSettings.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        llmProvider: config.DEFAULT_LLM_PROVIDER,
        generationModel: 'claude-sonnet-5-5',
        scoringModel: 'claude-haiku-5-5',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        ollamaBaseUrl: config.OLLAMA_BASE_URL,
      },
    });
    return profileSettingsSchema.parse(value);
  }
  secret(userId: string, kind: string) {
    return this.db.userSecret.findUnique({
      where: { userId_kind: { userId, kind } },
    });
  }
  async reserve(
    userId: string,
    input: {
      purpose: string;
      provider: string;
      model: string;
      tokens: number;
      promptVersion: string | null;
    },
    limit: number,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const now = new Date();
      const month = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const total = await tx.llmUsage.aggregate({
        where: { userId, createdAt: { gte: month } },
        _sum: { tokensIn: true, tokensOut: true, reservedTokens: true },
      });
      const used =
        (total._sum.tokensIn ?? 0) +
        (total._sum.tokensOut ?? 0) +
        (total._sum.reservedTokens ?? 0);
      if (used + input.tokens > limit)
        throw new LlmError('LLM_BUDGET_EXCEEDED');
      return tx.llmUsage.create({
        data: {
          userId,
          purpose: input.purpose,
          provider: input.provider,
          model: input.model,
          promptVersion: input.promptVersion,
          tokensIn: 0,
          tokensOut: 0,
          reservedTokens: input.tokens,
          costEstimate: null,
          status: 'pending',
        },
      });
    });
  }
  async settle(
    userId: string,
    id: string,
    usage: { tokensIn: number; tokensOut: number } | null,
    cost: number | null,
  ) {
    const known =
      usage !== null &&
      Number.isSafeInteger(usage.tokensIn) &&
      usage.tokensIn >= 0 &&
      Number.isSafeInteger(usage.tokensOut) &&
      usage.tokensOut >= 0;
    await this.db.llmUsage.updateMany({
      where: { id, userId, status: 'pending' },
      data: known
        ? {
            status: 'succeeded',
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            reservedTokens: 0,
            costEstimate: cost,
          }
        : { status: usage ? 'succeeded' : 'failed' },
    });
  }
  async summary(userId: string, limit: number) {
    const now = new Date();
    const month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const [total, unpricedCalls] = await Promise.all([
      this.db.llmUsage.aggregate({
        where: { userId, createdAt: { gte: month } },
        _sum: {
          tokensIn: true,
          tokensOut: true,
          reservedTokens: true,
          costEstimate: true,
        },
      }),
      this.db.llmUsage.count({
        where: { userId, createdAt: { gte: month }, costEstimate: null },
      }),
    ]);
    return {
      month: month.toISOString().slice(0, 7),
      tokensUsed: (total._sum.tokensIn ?? 0) + (total._sum.tokensOut ?? 0),
      tokensReserved: total._sum.reservedTokens ?? 0,
      tokenLimit: limit,
      estimatedCostUsd: total._sum.costEstimate?.toNumber() ?? 0,
      unpricedCalls,
    };
  }
}
