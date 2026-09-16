import {
  getOrCreateOwnEligibilityProfile,
  getOrCreateOwnScoringProfile,
  listDiscoveryLocationTokens,
} from '@career-os/database';
import Link from 'next/link';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { DiscoverySettingsForm } from './discovery-settings-form';

/**
 * D5B's settings surface — loads the caller's own scoring/eligibility profiles (creating the
 * canonical D4 defaults on first access via the same `getOrCreateOwn*Profile` functions the D4
 * CLI already uses — never a separate frontend default that could diverge, docs/JOB_DISCOVERY.md
 * "Discovery Scoring Profile" / "Eligibility profile") and hands them to the client form. All
 * three reads go through the session-scoped client under standard 4-policy RLS; no service-role
 * client, no client-supplied user id (`requireUser()` is the only source of `user.id`).
 */
export default async function DiscoverySettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [scoringProfile, eligibilityProfile, locationTokens] = await Promise.all([
    getOrCreateOwnScoringProfile(supabase, user.id),
    getOrCreateOwnEligibilityProfile(supabase, user.id),
    listDiscoveryLocationTokens(supabase),
  ]);

  return (
    <div className="max-w-2xl space-y-6 pb-6">
      <div>
        <Link href="/discover" className="text-muted-foreground text-sm hover:underline">
          ← Back to Discover
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Discovery preferences</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure how Career OS ranks and evaluates jobs for you.
        </p>
      </div>

      <DiscoverySettingsForm
        initialScoringProfile={scoringProfile}
        initialEligibilityProfile={eligibilityProfile}
        locationTokens={locationTokens}
      />
    </div>
  );
}
