import {
  discoverySettingsEligibilityRequestSchema,
  discoverySettingsScoringRequestSchema,
  type DiscoverySettingsEligibilityRequest,
  type DiscoverySettingsRequest,
  type DiscoverySettingsScoringRequest,
} from '../schemas/discovery-settings-request';
import type { DiscoveryEligibilityProfile } from '../schemas/discovery-eligibility-profile';
import type { DiscoveryScoringProfile } from '../schemas/discovery-scoring-profile';

/**
 * No-op-save detection for `/settings/discovery` (D5B) — deliberately a plain deep-equality
 * comparison, not a new hash/version scheme. There is no existing content-hash mechanism this
 * could reuse: `discovery_scoring_profiles.profile_version` is a *schema-shape* version (bumped
 * when the row's own columns change, docs/JOB_DISCOVERY.md "Discovery Scoring Profile"), not a
 * content hash of a user's chosen values, and `rankingVersion`/`featureVersion`/
 * `eligibilityVersion` version the *engine's rules*, not one user's preference data — neither
 * answers "did this specific save actually change anything." A canonical (key-sorted) JSON
 * comparison is the smallest correct tool for that question.
 */

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Trims a full persisted profile down to the same shape a save request carries, via the same
 * Zod schema the request itself is validated against — so the comparison is always against
 * exactly the fields a user can actually submit, never accidentally including a server-derived
 * field like `updatedAt` (which would make every save look "changed"). Zod's default `strip`
 * behavior does the field selection; nothing here duplicates the field list. */
function currentScoringForComparison(profile: DiscoveryScoringProfile): DiscoverySettingsScoringRequest {
  return discoverySettingsScoringRequestSchema.parse(profile);
}
function currentEligibilityForComparison(
  profile: DiscoveryEligibilityProfile,
): DiscoverySettingsEligibilityRequest {
  return discoverySettingsEligibilityRequestSchema.parse(profile);
}

export interface DiscoverySettingsChangeResult {
  scoringChanged: boolean;
  eligibilityChanged: boolean;
}

/**
 * Compares a validated save request against the currently-persisted profiles. Order-independent
 * for every `jsonb` preference map (`{A:5,B:3}` and `{B:3,A:5}` compare equal, as they must — a
 * map is unordered data, and a naive `JSON.stringify` comparison would wrongly call that a
 * change) via the key-sorted `stableStringify` above.
 */
export function computeDiscoverySettingsChanges(
  current: { scoring: DiscoveryScoringProfile; eligibility: DiscoveryEligibilityProfile },
  next: DiscoverySettingsRequest,
): DiscoverySettingsChangeResult {
  const currentScoring = currentScoringForComparison(current.scoring);
  const currentEligibility = currentEligibilityForComparison(current.eligibility);

  return {
    scoringChanged: stableStringify(currentScoring) !== stableStringify(next.scoring),
    eligibilityChanged: stableStringify(currentEligibility) !== stableStringify(next.eligibility),
  };
}
