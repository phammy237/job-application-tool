'use server';

import { isFeatureEnabled } from '@career-os/database';
import { FEATURE_FLAG_KEYS } from '@career-os/shared';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

export interface AuthFormState {
  error: string | null;
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  redirect('/dashboard');
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const supabase = await createClient();

  // docs/PRODUCT_SPEC.md §8: registration is configurable via a feature flag, closed by
  // default during private beta. Checked server-side, not just hidden in the UI.
  const publicSignupsEnabled = await isFeatureEnabled(
    supabase,
    FEATURE_FLAG_KEYS.PUBLIC_SIGNUPS_ENABLED,
  );
  if (!publicSignupsEnabled) {
    return {
      error:
        'Sign-ups are currently invite-only. During local development, flip the ' +
        'public_signups_enabled feature flag (or create your account directly in Supabase Studio).',
    };
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return { error: error.message };
  }

  redirect('/login?confirmEmail=1');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
