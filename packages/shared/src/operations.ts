import { z } from 'zod';

// Numeric five-field UTC cron syntax; no seconds, names or extensions.
export function validCollectionCron(value: string): boolean {
  const fields = value.trim().split(/\s+/);
  const bounds = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ] as const;
  if (fields.length !== bounds.length) return false;
  const syntaxValid = fields.every((field, i) =>
    field.split(',').every((part) => {
      const match = /^(\*|\d{1,2}(?:-\d{1,2})?)(?:\/(\d{1,2}))?$/.exec(part);
      if (!match) return false;
      const [min, max] = bounds[i]!;
      if (match[2] && (+match[2] < 1 || +match[2] > max - min + 1))
        return false;
      if (match[1] === '*') return true;
      const [start, end = start] = match[1]!.split('-').map(Number);
      return start! >= min && end! <= max && start! <= end!;
    }),
  );
  if (!syntaxValid) return false;
  if (fields[4] !== '*') return true;
  const expand = (field: string, min: number, max: number) =>
    field.split(',').flatMap((part) => {
      const [range, stepText] = part.split('/');
      const step = stepText ? Number(stepText) : 1;
      const [start, end] =
        range === '*' ? [min, max] : range!.split('-').map(Number);
      const last = end ?? (stepText ? max : start!);
      return Array.from(
        { length: Math.floor((last! - start!) / step) + 1 },
        (_, i) => start! + i * step,
      );
    });
  const days = expand(fields[2]!, 1, 31),
    months = expand(fields[3]!, 1, 12);
  // A leap-year calendar covers every possible month/day combination.
  // Reject impossible dates before a malformed schedule can block reconciliation.
  return months.some((month) =>
    days.some(
      (day) =>
        new Date(Date.UTC(2000, month - 1, day)).getUTCMonth() === month - 1,
    ),
  );
}
export const collectionCronSchema = z
  .string()
  .trim()
  .max(100)
  .refine(validCollectionCron);
export const operationsStatusSchema = z.strictObject({
  backupsEnabled: z.boolean(),
  lastBackupAt: z.iso.datetime().nullable(),
  backupStatus: z.enum(['disabled', 'pending', 'succeeded', 'failed']),
  updatedAt: z.iso.datetime(),
});
export const operationsEnvironmentSchema = z
  .object({
    JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(60),
    BACKUP_S3_ENDPOINT: z.string().default(''),
    BACKUP_S3_BUCKET: z.string().max(63).default(''),
    BACKUP_S3_ACCESS_KEY: z.string().default(''),
    BACKUP_S3_SECRET_KEY: z.string().default(''),
    BACKUP_S3_REGION: z.string().min(1).default('us-east-1'),
    BACKUP_AGE_RECIPIENT: z.string().default(''),
  })
  .superRefine((v, ctx) => {
    const values = [
      v.BACKUP_S3_ENDPOINT,
      v.BACKUP_S3_BUCKET,
      v.BACKUP_S3_ACCESS_KEY,
      v.BACKUP_S3_SECRET_KEY,
      v.BACKUP_AGE_RECIPIENT,
    ];
    if (!values.some(Boolean)) return;
    if (!values.every(Boolean))
      ctx.addIssue({
        code: 'custom',
        message: 'Complete backup configuration required',
      });
    try {
      const url = new URL(v.BACKUP_S3_ENDPOINT);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['BACKUP_S3_ENDPOINT'],
        message: 'HTTPS endpoint required',
      });
    }
    if (
      !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(
        v.BACKUP_AGE_RECIPIENT,
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['BACKUP_AGE_RECIPIENT'],
        message: 'Expected age X25519 public recipient',
      });
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v.BACKUP_S3_BUCKET))
      ctx.addIssue({
        code: 'custom',
        path: ['BACKUP_S3_BUCKET'],
        message: 'Invalid bucket',
      });
  });
export type OperationsEnvironment = z.infer<typeof operationsEnvironmentSchema>;
