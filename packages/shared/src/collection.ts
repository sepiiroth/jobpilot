import { z } from 'zod';
export const collectionSourceSchema = z.enum([
  'adzuna',
  'greenhouse',
  'lever',
  'ashby',
]);
export const collectionStatsSchema = z.object({
  sourcesTotal: z.number().int().nonnegative(),
  sourcesProcessed: z.number().int().nonnegative(),
  found: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  embeddingsReady: z.number().int().nonnegative(),
});
export const collectionErrorSchema = z.object({
  source: z.string(),
  code: z.string(),
});
export const collectionRunSchema = z.object({
  id: z.uuid(),
  stage: z.enum(['collection', 'scoring']).default('collection'),
  status: z.enum([
    'queued',
    'running',
    'completed',
    'completed_with_errors',
    'failed',
  ]),
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  stats: collectionStatsSchema,
  errors: z.array(collectionErrorSchema),
});
export const collectionJobSchema = z.strictObject({
  runId: z.uuid(),
  userId: z.uuid(),
});
export const embeddingJobSchema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
});
export const queueNames = {
  collection: 'collection',
  embedding: 'embedding',
  scoring: 'scoring',
} as const;
export const collectionEnvironmentSchema = z.object({
  COLLECTION_COOLDOWN_MINUTES: z.coerce
    .number()
    .int()
    .min(0)
    .max(1440)
    .default(30),
  COLLECTION_QUEUE_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('jobpilot'),
  ADZUNA_DAILY_REQUEST_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(100),
  COLLECTION_MAX_REQUESTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(2000)
    .default(200),
  COLLECTION_MAX_OFFERS: z.coerce.number().int().min(1).max(10000).default(500),
  COLLECTION_MAX_PAGES: z.coerce.number().int().min(1).max(50).default(5),
  JOBPILOT_REPOSITORY_URL: z
    .url()
    .refine(
      (v) =>
        new URL(v).protocol === 'https:' &&
        !new URL(v).username &&
        !new URL(v).password,
    )
    .default('https://github.com/sepiiroth/jobpilot'),
});
export type CollectionEnvironment = z.infer<typeof collectionEnvironmentSchema>;
export type CollectionStats = z.infer<typeof collectionStatsSchema>;
export type CollectionRun = z.infer<typeof collectionRunSchema>;

export function queueConnection(url: string, blocking = false) {
  const u = new URL(url);
  if (!['redis:', 'rediss:'].includes(u.protocol))
    throw new Error('Invalid Valkey URL');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    db: Number(u.pathname.slice(1) || 0),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: blocking ? null : 1,
    enableOfflineQueue: blocking,
    connectTimeout: 3000,
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 3000),
  };
}
