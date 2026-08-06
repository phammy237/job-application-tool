import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const userSettingsSchema = z.object({
  userId: uuidSchema,
  gmailIntegrationEnabled: z.boolean().default(false),
  aiRequestsThisPeriod: z.number().int().default(0),
  aiRequestPeriodStartedAt: isoDateTimeSchema,
  aiRequestLimit: z.number().int().default(50),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;
