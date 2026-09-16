import { z } from 'zod';
import { discoveryEligibilityProfileSchema } from './discovery-eligibility-profile';
import { discoveryScoringProfileSchema } from './discovery-scoring-profile';

/**
 * The `/settings/discovery` save payload (D5B) — deliberately composed from the *existing* D4
 * profile schemas via `.omit()` rather than redefined field-by-field, so the request shape can
 * never drift from what `discovery_scoring_profiles`/`discovery_eligibility_profiles` actually
 * persist (docs/JOB_DISCOVERY.md "Discovery Scoring Profile" / "Eligibility profile"). Every
 * field is required (not `.partial()`, unlike `discoveryScoringProfileUpdateSchema`/
 * `discoveryEligibilityProfileUpdateSchema`): the settings form always submits its complete
 * current state — `updateOwnScoringProfile`'s own doc comment already establishes "the caller
 * always supplies the complete intended map for each preference bucket," and this request schema
 * is that same convention applied to the whole form, not a new one invented for the UI.
 */
export const discoverySettingsScoringRequestSchema = discoveryScoringProfileSchema.omit({
  userId: true,
  profileVersion: true,
  createdAt: true,
  updatedAt: true,
});
export type DiscoverySettingsScoringRequest = z.infer<typeof discoverySettingsScoringRequestSchema>;

export const discoverySettingsEligibilityRequestSchema = discoveryEligibilityProfileSchema.omit({
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type DiscoverySettingsEligibilityRequest = z.infer<
  typeof discoverySettingsEligibilityRequestSchema
>;

export const discoverySettingsRequestSchema = z.object({
  scoring: discoverySettingsScoringRequestSchema,
  eligibility: discoverySettingsEligibilityRequestSchema,
});
export type DiscoverySettingsRequest = z.infer<typeof discoverySettingsRequestSchema>;
