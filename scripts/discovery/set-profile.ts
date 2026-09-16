/**
 * Development-time configuration for a Discovery Scoring/Eligibility Profile
 * (docs/JOB_DISCOVERY.md "Profile configuration for development") — D5 will build the real
 * settings UI; this is the safe, Zod-validated way to configure/test a profile without hand-
 * editing SQL. Every field is optional/partial: only what's present in the file is written.
 *
 * File shape:
 *   {
 *     "preset": "CUSTOM",
 *     "criteriaWeights": { "ROLE_FIT": 10, "COMPETENCY_FIT": 9, ... },
 *     "rolePreferences": { "PRODUCT_MANAGEMENT": 10, "SOFTWARE_ENGINEERING": 2 },
 *     "seniorityPreferences": { "SENIOR": 8 },
 *     "locationPreferences": { "NEW_YORK_NY": "PREFERRED", "SAN_FRANCISCO_CA": "EXCLUDE" },
 *     "workModePreferences": { "REMOTE": 10, "HYBRID": 6 },
 *     "employmentTypePreferences": { "FULL_TIME": 10, "INTERNSHIP": 8 },
 *     "eligibility": {
 *       "currentlyAuthorizedToWork": true,
 *       "requiresSponsorshipNow": false,
 *       "requiresSponsorshipFuture": true,
 *       "isUsCitizen": false,
 *       "graduationYear": 2028
 *     }
 *   }
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/discovery/set-profile.ts --user-id <uuid> <path-to-profile.json>
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  criteriaWeightsSchema,
  discoveryEligibilityProfileUpdateSchema,
  discoveryScoringPresetSchema,
  employmentTypePreferencesSchema,
  locationPreferencesSchema,
  rolePreferencesSchema,
  seniorityPreferencesSchema,
  workModePreferencesSchema,
} from '@career-os/shared';
import {
  createSupabaseAdminClient,
  updateOwnEligibilityProfile,
  updateOwnScoringProfile,
} from '@career-os/database';

const setProfileInputSchema = z.object({
  preset: discoveryScoringPresetSchema.optional(),
  criteriaWeights: criteriaWeightsSchema.optional(),
  rolePreferences: rolePreferencesSchema.optional(),
  seniorityPreferences: seniorityPreferencesSchema.optional(),
  locationPreferences: locationPreferencesSchema.optional(),
  workModePreferences: workModePreferencesSchema.optional(),
  employmentTypePreferences: employmentTypePreferencesSchema.optional(),
  eligibility: discoveryEligibilityProfileUpdateSchema.optional(),
});

function parseArgs(argv: string[]): { userId: string; filePath: string } {
  const userIdIndex = argv.indexOf('--user-id');
  const userId = userIdIndex === -1 ? undefined : argv[userIdIndex + 1];
  if (!userId) throw new Error('Usage: set-profile.ts --user-id <uuid> <path-to-profile.json>');

  const filePath = argv.filter((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--user-id')[0];
  if (!filePath) throw new Error('Usage: set-profile.ts --user-id <uuid> <path-to-profile.json>');

  return { userId, filePath };
}

async function main(): Promise<void> {
  const { userId, filePath } = parseArgs(process.argv.slice(2));

  const raw = readFileSync(filePath, 'utf-8');
  const parsedJson: unknown = JSON.parse(raw);
  const input = setProfileInputSchema.parse(parsedJson);

  const supabase = createSupabaseAdminClient();

  const { eligibility, ...scoringUpdate } = input;
  if (Object.keys(scoringUpdate).length > 0) {
    const profile = await updateOwnScoringProfile(supabase, userId, scoringUpdate);
    console.log(`Updated scoring profile for ${userId}: preset=${profile.preset}`);
  }

  if (eligibility && Object.keys(eligibility).length > 0) {
    await updateOwnEligibilityProfile(supabase, userId, eligibility);
    console.log(`Updated eligibility profile for ${userId}.`);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
