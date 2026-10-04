import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const userSettingsSchema = z.object({
  userId: uuidSchema,
  gmailIntegrationEnabled: z.boolean().default(false),
  /** Added in migration 0046 — a second, narrower opt-in on top of gmailIntegrationEnabled.
   * Connecting Gmail only ever enables manual "Sync Gmail" clicks (and the throttled auto-check
   * while /settings is open); this one additionally lets the scheduled background cron job
   * (apps/web's /api/cron/gmail-background-sync) scan this user's inbox with no app open at all.
   * `.default(false)` (not just `.nullable()`) so a database missing migration 0046 degrades to
   * "background tracking off" rather than failing every settings read. */
  backgroundGmailTrackingEnabled: z.boolean().default(false),
  /** Added in migration 0047 (D9 Phase A) — lets the scheduled /api/cron/auto-queue job
   * auto-queue the user's own high-Match/high-Coverage/non-CONFLICT /discover candidates as
   * ordinary SAVED applications for review on /dashboard. Independent of both Gmail toggles above
   * — no connection prerequisite, no shared opt-in. `.default(false)` so a database missing
   * migration 0047 degrades to "Auto Mode off" rather than failing every settings read. */
  autoModeEnabled: z.boolean().default(false),
  aiRequestsThisPeriod: z.number().int().default(0),
  aiRequestPeriodStartedAt: isoDateTimeSchema,
  aiRequestLimit: z.number().int().default(50),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;
