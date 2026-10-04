'use server';

import { rotateOwnPortfolioApiKey, upsertOwnPortfolioSettings } from '@career-os/database';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { parsePortfolioSettingsForm } from './settings-schema';

export interface SaveSettingsState {
  ok?: boolean;
  error?: string;
}
export interface RotateKeyState {
  /** Plaintext key — present only in the response to the call that generated it. */
  key?: string;
  error?: string;
}

/** user_id always comes from the verified session; the write goes through the RLS-scoped client. */
export async function savePortfolioSettings(
  _prev: SaveSettingsState,
  formData: FormData,
): Promise<SaveSettingsState> {
  const user = await requireUser();
  const parsed = parsePortfolioSettingsForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid settings.' };
  }
  try {
    const supabase = await createClient();
    await upsertOwnPortfolioSettings(supabase, user.id, parsed.data);
    revalidatePath('/my/settings');
    return { ok: true };
  } catch (error) {
    console.error('[career-os] save portfolio settings failed', error);
    return { error: 'Could not save settings. Please try again.' };
  }
}

/** Generates or rotates the API key. Only its SHA-256 hash is stored; the plaintext is returned once. */
export async function rotatePortfolioApiKey(_prev: RotateKeyState): Promise<RotateKeyState> {
  const user = await requireUser();
  try {
    const supabase = await createClient();
    const key = await rotateOwnPortfolioApiKey(supabase, user.id);
    revalidatePath('/my/settings');
    return { key };
  } catch (error) {
    console.error('[career-os] rotate portfolio key failed', error);
    return { error: 'Could not generate a key. Please try again.' };
  }
}
