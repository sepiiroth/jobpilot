import { it, expect } from 'vitest';
import {
  applicationFieldsSchema,
  applicationCreateSchema,
  applicationUpdateSchema,
  isFollowUpDue,
  localCalendarDate,
} from './applications.ts';
it('validates calendar dates, statuses, bounded notes and positive revisions', () => {
  const fields = {
    status: 'applied',
    appliedAt: '2026-11-06',
    followUpAt: '2026-11-10',
    notes: 'Synthetic note',
    resumeDocId: null,
    letterDocId: null,
  };
  expect(applicationFieldsSchema.parse(fields)).toEqual(fields);
  expect(applicationCreateSchema.parse({})).toEqual({
    status: 'to_apply',
    appliedAt: null,
  });
  expect(
    applicationFieldsSchema.safeParse({ ...fields, appliedAt: null }).success,
  ).toBe(false);
  expect(
    applicationFieldsSchema.safeParse({ ...fields, followUpAt: '2026-02-30' })
      .success,
  ).toBe(false);
  expect(
    applicationFieldsSchema.safeParse({ ...fields, notes: 'x'.repeat(10001) })
      .success,
  ).toBe(false);
  expect(
    applicationUpdateSchema.safeParse({ revision: 0, fields }).success,
  ).toBe(false);
  expect(
    applicationUpdateSchema.safeParse({
      revision: 1,
      fields,
      foreignUserId: 'ignored',
    }).success,
  ).toBe(false);
});
it('shows due reminders on the current local calendar day and excludes closed stages', () => {
  expect(localCalendarDate(new Date(2026, 10, 6, 0, 30))).toBe('2026-11-06');
  for (const status of ['to_apply', 'applied', 'interview'] as const) {
    expect(
      isFollowUpDue({ status, followUpAt: '2026-11-05' }, '2026-11-06'),
    ).toBe(true);
    expect(
      isFollowUpDue({ status, followUpAt: '2026-11-06' }, '2026-11-06'),
    ).toBe(true);
    expect(
      isFollowUpDue({ status, followUpAt: '2026-11-07' }, '2026-11-06'),
    ).toBe(false);
  }
  expect(
    isFollowUpDue({ status: 'applied', followUpAt: null }, '2026-11-06'),
  ).toBe(false);
  for (const status of ['offer', 'rejected'] as const)
    expect(
      isFollowUpDue({ status, followUpAt: '2026-11-05' }, '2026-11-06'),
    ).toBe(false);
});
