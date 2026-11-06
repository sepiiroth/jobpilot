import { z } from 'zod';
import { applicationStatusSchema } from './index.ts';
export const applicationStatuses = [
  'to_apply',
  'applied',
  'interview',
  'offer',
  'rejected',
] as const;
export const applicationFieldsSchema = z
  .strictObject({
    status: applicationStatusSchema,
    appliedAt: z.iso.date().nullable(),
    followUpAt: z.iso.date().nullable(),
    notes: z.string().max(10000).nullable(),
    resumeDocId: z.uuid().nullable(),
    letterDocId: z.uuid().nullable(),
  })
  .refine((v) => v.status === 'to_apply' || v.appliedAt !== null, {
    path: ['appliedAt'],
    message: 'Application date required',
  });
export const applicationCreateSchema = z.strictObject({
  status: applicationStatusSchema.default('to_apply'),
  appliedAt: z.iso.date().nullable().default(null),
});
export const applicationUpdateSchema = z.strictObject({
  revision: z.number().int().positive(),
  fields: applicationFieldsSchema,
});
export const applicationMoveSchema = z.strictObject({
  revision: z.number().int().positive(),
  status: applicationStatusSchema,
  appliedAt: z.iso.date().optional(),
});
export const applicationRecordSchema = z.strictObject({
  id: z.uuid(),
  jobOfferId: z.uuid(),
  matchId: z.uuid().nullable(),
  title: z.string(),
  company: z.string(),
  url: z.url().refine((v) => ['http:', 'https:'].includes(new URL(v).protocol)),
  description: z.string(),
  status: applicationStatusSchema,
  appliedAt: z.iso.date().nullable(),
  followUpAt: z.iso.date().nullable(),
  notes: z.string().nullable(),
  resumeDocId: z.uuid().nullable(),
  letterDocId: z.uuid().nullable(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const applicationPageSchema = z.strictObject({
  items: z.array(applicationRecordSchema),
  nextCursor: z.uuid().nullable(),
});
export const applicationDocumentOptionSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['resume', 'cover_letter']),
  version: z.number().int().positive(),
  resumeTitle: z.string(),
  blocked: z.boolean(),
});
export const applicationDocumentPageSchema = z.strictObject({
  items: z.array(applicationDocumentOptionSchema),
  nextCursor: z.uuid().nullable(),
});
export type ApplicationRecord = z.infer<typeof applicationRecordSchema>;
export type ApplicationFields = z.infer<typeof applicationFieldsSchema>;
export type ApplicationStatus = ApplicationRecord['status'];
export function localCalendarDate(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
export function isFollowUpDue(
  application: Pick<ApplicationRecord, 'status' | 'followUpAt'>,
  today = localCalendarDate(),
): boolean {
  return (
    application.followUpAt !== null &&
    application.followUpAt <= today &&
    !['offer', 'rejected'].includes(application.status)
  );
}
