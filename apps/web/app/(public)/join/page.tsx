import { isFeatureEnabled } from '@career-os/database';
import { FEATURE_FLAG_KEYS } from '@career-os/shared';
import Link from 'next/link';
import { createClient } from '../../../lib/supabase/server';
import { JoinForm } from './join-form';

export default async function JoinPage() {
  const supabase = await createClient();
  const publicSignupsEnabled = await isFeatureEnabled(
    supabase,
    FEATURE_FLAG_KEYS.PUBLIC_SIGNUPS_ENABLED,
  );

  return (
    <div className="mx-auto max-w-sm px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">Join Career OS</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Currently in private beta — see{' '}
        <Link href="/" className="text-primary hover:underline">
          what it does
        </Link>
        .
      </p>

      <div className="mt-6">
        {publicSignupsEnabled ? (
          <JoinForm />
        ) : (
          <div className="border-border bg-card text-muted-foreground rounded-md border p-4 text-sm">
            Sign-ups are invite-only right now. Reach out if you&apos;d like early access.
          </div>
        )}
      </div>

      <p className="text-muted-foreground mt-6 text-sm">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
