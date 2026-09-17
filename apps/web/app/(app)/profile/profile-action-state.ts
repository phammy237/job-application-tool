/**
 * Deliberately NOT inside actions.ts: a `'use server'` file may only export async functions —
 * every other export is a hard build/runtime error ("A 'use server' file can only export async
 * functions, found object"). This was a second real crash found during live verification of the
 * Phase A fix (`Application error: a server-side exception has occurred`, digest 1808891191) —
 * caused by exactly this constant living in actions.ts. Types are erased at compile time so
 * `ProfileActionState` itself would have been safe to keep there, but the runtime
 * `INITIAL_PROFILE_ACTION_STATE` object is not — both live here instead, imported by actions.ts
 * (type-only) and by every client component that calls `useActionState`.
 */
export interface ProfileActionState {
  error: string | null;
}

export const INITIAL_PROFILE_ACTION_STATE: ProfileActionState = { error: null };
