import { z } from 'zod';
import {
  locationSchema,
  remoteSchema,
  contractTypeSchema,
  jobSourceIdSchema,
  llmAnalysisSchema,
  matchStatusSchema,
} from './index.ts';
export const scoringEnvironmentSchema = z.object({
  SCORING_LLM_TOP_N: z.coerce.number().int().min(0).max(100).default(30),
});
export const filterNoteSchema = z.enum([
  'excluded_keyword',
  'missing_keyword',
  'contract',
  'remote',
  'location',
  'salary',
  'contract_unknown',
  'remote_unknown',
  'location_unknown',
  'distance_unverified',
  'salary_unknown',
  'salary_currency_unknown',
]);
export const jobQuerySchema = z
  .object({
    searchId: z.uuid().optional(),
    source: jobSourceIdSchema.optional(),
    status: matchStatusSchema.optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Invalid date range');
export const jobStatusInputSchema = z.strictObject({
  status: z.enum(['new', 'interesting', 'ignored']),
});
export const jobRecordSchema = z.object({
  id: z.uuid(),
  offerId: z.uuid(),
  searchId: z.uuid(),
  searchName: z.string(),
  title: z.string(),
  company: z.string(),
  source: jobSourceIdSchema,
  url: z.url().refine((v) => ['http:', 'https:'].includes(new URL(v).protocol)),
  alternateUrls: z.array(z.string()),
  location: locationSchema,
  remote: remoteSchema,
  contractType: contractTypeSchema,
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  status: matchStatusSchema,
  similarity: z.number().finite().nullable(),
  score: z.number().int().min(0).max(100).nullable(),
  analysis: llmAnalysisSchema.nullable(),
  state: z.enum(['waiting', 'ranked', 'analyzing', 'ready', 'failed']),
  notes: z.array(filterNoteSchema),
  description: z.string(),
});
export const jobsPageSchema = z.object({
  items: z.array(jobRecordSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const jobsSummarySchema = z.object({
  newOffers: z.number().int(),
  matchedOffers: z.number().int(),
  analyzed: z.number().int(),
  best: z.array(jobRecordSchema),
});
export type JobQuery = z.infer<typeof jobQuerySchema>;
export type JobRecord = z.infer<typeof jobRecordSchema>;
export type FilterNote = z.infer<typeof filterNoteSchema>;
