import { collectionCronSchema } from './operations.ts';
import { z } from 'zod';
import { embeddingStateSchema } from './llm.ts';
import { resumeSchema, searchSchema, settingsSchema } from './index.ts';

export const resumeInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(150),
  data: resumeSchema,
  isArchived: z.boolean().default(false),
});
export const resumeRecordSchema = resumeInputSchema
  .extend({
    id: z.uuid(),
    embeddingStatus: embeddingStateSchema.default('pending'),
  })
  .strip();
export const searchInputSchema = searchSchema.omit({ sources: true }).extend({
  sources: z
    .array(z.enum(['adzuna', 'greenhouse', 'lever', 'ashby', 'email']))
    .min(1),
});
export const searchRecordSchema = searchInputSchema.extend({ id: z.uuid() });
export const secretKindSchema = z.enum([
  'llm_anthropic',
  'llm_openai',
  'llm_mistral',
  'embedding_openai',
  'embedding_voyage',
  'embedding_mistral',
  'adzuna_app_id',
  'adzuna_app_key',
  'imap',
]);
export const secretInputSchema = z.strictObject({
  value: z.string().min(8).max(8192),
});
export const secretStatusSchema = z.strictObject({
  kind: secretKindSchema,
  configured: z.boolean(),
  lastFour: z.string().length(4).nullable(),
});
export const companyInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(150),
  atsType: z.enum(['greenhouse', 'lever', 'ashby']),
  atsToken: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .regex(/^[a-zA-Z0-9_-]+$/),
});
export const companyRecordSchema = companyInputSchema
  .extend({ id: z.uuid() })
  .strip();
export const imapSettingsSchema = z.strictObject({
  host: z
    .string()
    .trim()
    .max(253)
    .regex(
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
    ),
  port: z.number().int().min(1).max(65535).default(993),
  username: z.string().trim().min(1).max(320),
  mailbox: z.string().trim().min(1).max(255).default('INBOX'),
  allowedSenders: z.array(z.email()).max(100),
});
export const profileSettingsSchema = settingsSchema
  .extend({
    collectionCron: collectionCronSchema.nullable().default(null),
    collectionCooldownMin: z.number().int().min(0).max(10080).default(30),
  })
  .extend({
    embeddingProvider: z.enum(['openai', 'voyage', 'mistral', 'ollama']),
    ollamaBaseUrl: z
      .url()
      .refine(
        (v) =>
          ['http:', 'https:'].includes(new URL(v).protocol) &&
          !new URL(v).username &&
          !new URL(v).password,
      ),
    imap: imapSettingsSchema.nullable(),
  });
export type ResumeInput = z.infer<typeof resumeInputSchema>;
export type ResumeRecord = z.infer<typeof resumeRecordSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchRecord = z.infer<typeof searchRecordSchema>;
export type ProfileSettings = z.infer<typeof profileSettingsSchema>;
export type SecretKind = z.infer<typeof secretKindSchema>;
export type SecretStatus = z.infer<typeof secretStatusSchema>;
export type CompanyInput = z.infer<typeof companyInputSchema>;
export type CompanyRecord = z.infer<typeof companyRecordSchema>;
