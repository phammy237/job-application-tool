import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/** Not user-owned — see docs/DATA_MODEL.md "feature_flags". */
export const featureFlagSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean().default(false),
  description: z.string().nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/** Known flag keys referenced across docs/ — keep in sync with supabase seed data. */
export const FEATURE_FLAG_KEYS = {
  PUBLIC_SIGNUPS_ENABLED: 'public_signups_enabled',
  GMAIL_INTEGRATION_ENABLED: 'gmail_integration_enabled',
} as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];
