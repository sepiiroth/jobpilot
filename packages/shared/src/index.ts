import { z } from 'zod';
export const jobSourceIdSchema = z.enum([
  'adzuna',
  'greenhouse',
  'lever',
  'ashby',
  'email',
  'france_travail',
]);
export const remoteSchema = z.enum(['none', 'hybrid', 'full', 'unknown']);
export const contractTypeSchema = z.enum([
  'permanent',
  'fixed_term',
  'contract',
  'temporary',
  'internship',
  'apprenticeship',
  'other',
  'unknown',
]);
export const matchStatusSchema = z.enum([
  'new',
  'interesting',
  'ignored',
  'applied',
]);
export const applicationStatusSchema = z.enum([
  'to_apply',
  'applied',
  'interview',
  'offer',
  'rejected',
]);
export const llmProviderSchema = z.enum([
  'anthropic',
  'openai',
  'mistral',
  'ollama',
]);
export const locationSchema = z.object({
  city: z.string(),
  postalCode: z.string().optional(),
  country: z.string().length(2),
});
const date = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/);
const link = z
  .url()
  .refine((v) => ['http:', 'https:'].includes(new URL(v).protocol));
export const resumeSchema = z.object({
  basics: z.object({
    name: z.string().min(1),
    label: z.string().optional(),
    email: z.email().optional(),
    phone: z.string().optional(),
    url: link.optional(),
    summary: z.string().optional(),
    location: locationSchema.optional(),
    profiles: z
      .array(z.object({ network: z.string(), username: z.string(), url: link }))
      .default([]),
  }),
  work: z
    .array(
      z.object({
        name: z.string(),
        position: z.string(),
        url: link.optional(),
        startDate: date,
        endDate: date.optional(),
        summary: z.string().optional(),
        highlights: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string(),
        area: z.string(),
        studyType: z.string(),
        startDate: date.optional(),
        endDate: date.optional(),
        courses: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        name: z.string(),
        level: z.string().optional(),
        keywords: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  languages: z
    .array(z.object({ language: z.string(), fluency: z.string() }))
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        url: link.optional(),
        highlights: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export const searchSchema = z.object({
  name: z.string().min(1),
  resumeId: z.uuid(),
  titles: z.array(z.string().min(1)).min(1),
  includeKeywords: z.array(z.string()).default([]),
  excludeKeywords: z.array(z.string()).default([]),
  locations: z.array(locationSchema).default([]),
  radiusKm: z.number().int().nonnegative().optional(),
  remote: z.array(remoteSchema),
  contractTypes: z.array(contractTypeSchema),
  salaryMin: z.number().nonnegative().optional(),
  seniority: z.string().optional(),
  sources: z.array(jobSourceIdSchema).min(1),
  isActive: z.boolean().default(true),
});
export const normalizedJobOfferSchema = z
  .object({
    sourceId: jobSourceIdSchema,
    externalId: z.string().min(1),
    url: link,
    title: z.string().min(1),
    company: z.string().min(1),
    location: locationSchema,
    remote: remoteSchema,
    contractType: contractTypeSchema,
    salaryMin: z.number().nonnegative().nullable(),
    salaryMax: z.number().nonnegative().nullable(),
    salaryCurrency: z.string().length(3).nullable(),
    description: z
      .string()
      .refine((v) => !/<[^>]+>/.test(v), 'HTML is not allowed'),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    fetchedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (v) =>
      v.salaryMin === null ||
      v.salaryMax === null ||
      v.salaryMin <= v.salaryMax,
    { message: 'Invalid salary range' },
  );
export const llmAnalysisSchema = z.object({
  score: z.number().int().min(0).max(100),
  strengths: z.array(z.string()).length(3),
  concerns: z.array(z.string()).length(3),
  missingSkills: z.array(z.string()),
});
export const settingsSchema = z.object({
  llmProvider: llmProviderSchema,
  generationModel: z.string().min(1),
  scoringModel: z.string().min(1),
  embeddingModel: z.string().min(1),
  collectionCron: z.string().nullable().default(null),
  collectionCooldownMin: z.number().int().nonnegative().default(30),
});
export type Resume = z.infer<typeof resumeSchema>;
export type SearchCriteria = z.infer<typeof searchSchema>;
export type NormalizedJobOffer = z.infer<typeof normalizedJobOfferSchema>;
export type LlmAnalysis = z.infer<typeof llmAnalysisSchema>;
export type UserSettings = z.infer<typeof settingsSchema>;
export type JobSourceId = z.infer<typeof jobSourceIdSchema>;

export {
  loginSchema,
  changePasswordSchema,
  deleteAccountSchema,
  type LoginInput,
  type ChangePasswordInput,
} from './auth.ts';

export {
  currentUserSchema,
  csrfResponseSchema,
  loginResponseSchema,
  type CurrentUser,
} from './auth.ts';
