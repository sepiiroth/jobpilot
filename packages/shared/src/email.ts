import { z } from 'zod';
import { locationSchema, remoteSchema, contractTypeSchema } from './index.ts';
export const emailExtractedOfferSchema = z
  .strictObject({
    url: z.url().refine((value) => {
      const u = new URL(value);
      return (
        ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
      );
    }),
    title: z.string().trim().min(1).max(300),
    company: z.string().trim().min(1).max(200),
    location: locationSchema,
    remote: remoteSchema,
    contractType: contractTypeSchema,
    salaryMin: z.number().finite().nonnegative().nullable(),
    salaryMax: z.number().finite().nonnegative().nullable(),
    salaryCurrency: z.string().length(3).nullable(),
    description: z.string().max(20000),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(
    (v) =>
      v.salaryMin === null ||
      v.salaryMax === null ||
      v.salaryMin <= v.salaryMax,
    'Invalid salary range',
  );
export const emailExtractionSchema = z.strictObject({
  jobs: z.array(emailExtractedOfferSchema).max(20),
});
export const emailEnvironmentSchema = z.object({
  ALLOW_PRIVATE_IMAP_HOST: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  EMAIL_ALERT_ALLOWED_SENDERS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.email()).max(100)),
  EMAIL_ALERT_MAX_MESSAGES: z.coerce.number().int().min(1).max(100).default(20),
  EMAIL_ALERT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(2000000)
    .default(512000),
  EMAIL_ALERT_CACHE_MESSAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100),
  EMAIL_ALERT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),
});
export type EmailEnvironment = z.infer<typeof emailEnvironmentSchema>;
export type EmailExtractedOffer = z.infer<typeof emailExtractedOfferSchema>;
