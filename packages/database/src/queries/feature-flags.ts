import {
  featureFlagSchema,
  type FeatureFlag,
  type FeatureFlagKey,
} from '@career-os/shared';
import { assertNoError } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

/**
 * feature_flags is not user-owned (docs/DATA_MODEL.md) — readable by any authenticated
 * client, writable only via service-role/migration. Fails closed: a missing row is treated
 * as disabled rather than throwing, so a flag that hasn't been seeded yet never accidentally
 * opens a gate.
 */
export async function isFeatureEnabled(
  supabase: CareerOsSupabaseClient,
  key: FeatureFlagKey,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('*')
    .eq('key', key)
    .maybeSingle();
  assertNoError(error, 'isFeatureEnabled');
  return data?.enabled ?? false;
}

export async function listFeatureFlags(
  supabase: CareerOsSupabaseClient,
): Promise<FeatureFlag[]> {
  const { data, error } = await supabase.from('feature_flags').select('*').order('key');
  assertNoError(error, 'listFeatureFlags');
  return (data ?? []).map((row) =>
    featureFlagSchema.parse({
      key: row.key,
      enabled: row.enabled,
      description: row.description,
      updatedAt: row.updated_at,
    }),
  );
}
