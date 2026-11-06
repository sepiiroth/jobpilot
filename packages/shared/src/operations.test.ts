import { expect, it } from 'vitest';
import {
  collectionCronSchema,
  operationsEnvironmentSchema,
} from './operations.ts';
it('validates bounded numeric five-field UTC cron schedules', () => {
  for (const value of [
    '0 7 * * 1-5',
    '*/30 * * * *',
    '0,30 8-18/2 1 1,6 0',
    '0 7 29 2 *',
    '0 7 31 2 1',
  ])
    expect(collectionCronSchema.safeParse(value).success, value).toBe(true);
  for (const value of [
    '* * * * * *',
    '60 7 * * *',
    '0 24 * * *',
    '0 7 0 * *',
    '0 7 * 13 *',
    '0 7 * * 7',
    '*/0 * * * *',
    '0 7 * * MON',
    '@daily',
    '0 7 10-2 * *',
    '0 7 31 2 *',
    '0 7 31 4,6,9,11 *',
  ])
    expect(collectionCronSchema.safeParse(value).success, value).toBe(false);
});
it('disables absent backups but rejects partial configuration and insecure endpoints', () => {
  expect(operationsEnvironmentSchema.parse({}).BACKUP_S3_BUCKET).toBe('');
  expect(
    operationsEnvironmentSchema.safeParse({ BACKUP_S3_BUCKET: 'demo' }).success,
  ).toBe(false);
  expect(
    operationsEnvironmentSchema.safeParse({ JOB_RETENTION_DAYS: 0 }).success,
  ).toBe(false);
});
