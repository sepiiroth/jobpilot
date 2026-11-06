import { z } from 'zod';
import { resumeSchema } from './index.ts';
export const generationParamsSchema = z.strictObject({
  tone: z.enum(['formal', 'neutral', 'direct']).default('neutral'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
  language: z.enum(['fr', 'en']).default('fr'),
});
export const documentKindSchema = z.enum(['resume', 'cover_letter']);
export const generationInputSchema = z.strictObject({
  resumeId: z.uuid(),
  kind: documentKindSchema,
  params: generationParamsSchema,
});
export const documentContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resume'), data: resumeSchema }),
  z.strictObject({
    kind: z.literal('cover_letter'),
    text: z.string().trim().min(1).max(20000),
  }),
]);
export const documentEditSchema = z.strictObject({
  content: documentContentSchema,
});
export const integrityIssueSchema = z.strictObject({
  id: z.string(),
  path: z.string(),
  code: z.enum(['added_fact', 'changed_text']),
  value: z.string(),
});
export const integrityReportSchema = z.strictObject({
  issues: z.array(integrityIssueSchema),
  approved: z.boolean(),
  blocked: z.boolean(),
  sourceChanged: z.boolean(),
});
export const generationCostSchema = z.strictObject({
  usageId: z.uuid().nullable(),
  provider: z.string(),
  model: z.string(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  uncertainAttempts: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().nullable(),
});
export const generatedDocumentSchema = z.strictObject({
  id: z.uuid(),
  jobOfferId: z.uuid(),
  resumeId: z.uuid(),
  kind: documentKindSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  content: documentContentSchema,
  params: generationParamsSchema,
  integrity: integrityReportSchema,
  cost: generationCostSchema,
});
export const documentReviewSchema = z.strictObject({
  issueIds: z.array(z.string()).max(1000),
  sourceFingerprint: z.string().length(64),
});
export const documentDetailSchema = generatedDocumentSchema.extend({
  sourceFingerprint: z.string().length(64),
});
export type GenerationParams = z.infer<typeof generationParamsSchema>;
export type DocumentContent = z.infer<typeof documentContentSchema>;
export type GenerationCost = z.infer<typeof generationCostSchema>;
export type IntegrityIssue = z.infer<typeof integrityIssueSchema>;
export type GeneratedDocument = z.infer<typeof documentDetailSchema>;

export const documentHistorySchema = z.strictObject({
  items: z.array(documentDetailSchema),
  nextCursor: z.uuid().nullable(),
});
