import { z } from 'zod';
import { resumeSchema } from './index.ts';
export const embeddingStateSchema = z.enum([
  'pending',
  'ready',
  'not_configured',
  'failed',
]);
export const importProposalSchema = z.strictObject({
  data: resumeSchema,
  warnings: z.array(z.string().max(1000)).max(100),
});
export const usageSummarySchema = z.object({
  month: z.string(),
  tokensUsed: z.number().int().nonnegative(),
  tokensReserved: z.number().int().nonnegative(),
  tokenLimit: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  unpricedCalls: z.number().int().nonnegative(),
});
export type ImportProposal = z.infer<typeof importProposalSchema>;
export type UsageSummary = z.infer<typeof usageSummarySchema>;
