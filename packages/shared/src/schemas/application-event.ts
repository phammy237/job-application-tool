import { z } from 'zod';
import { applicationStatusSchema } from './application';
import { isoDateTimeSchema, uuidSchema } from './common';

export const applicationEventTypeSchema = z.enum([
  'STATUS_CHANGE',
  'NOTE',
  'EMAIL_MATCHED',
  'MANUAL_EDIT',
]);
export type ApplicationEventType = z.infer<typeof applicationEventTypeSchema>;

export const applicationEventSourceSchema = z.enum(['USER', 'GMAIL_SYNC', 'SYSTEM']);
export type ApplicationEventSource = z.infer<typeof applicationEventSourceSchema>;

export const applicationEventSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  applicationId: uuidSchema,
  eventType: applicationEventTypeSchema,
  fromStatus: applicationStatusSchema.nullable(),
  toStatus: applicationStatusSchema.nullable(),
  source: applicationEventSourceSchema,
  emailSignalId: uuidSchema.nullable(),
  revertedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;
