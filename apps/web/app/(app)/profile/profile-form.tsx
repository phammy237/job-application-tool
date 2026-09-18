'use client';

import type { Profile } from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { useActionState } from 'react';
import { updateProfile } from './actions';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

/**
 * `overrides`/`overrideVersion`: how the /profile résumé-autofill panel prefills these fields
 * without persisting anything itself (CLAUDE.md-level product rule for this feature — autofill
 * only touches in-memory form state; the existing Save button below is still the one and only
 * persistence step). Every input here is uncontrolled (`defaultValue`), matching this form's
 * existing pattern and `useActionState`'s own uncontrolled-form convention, so applying a new
 * autofill after the form already mounted needs a full remount to pick up new `defaultValue`s —
 * `key={overrideVersion}` on the `<form>` does exactly that, incrementing once per autofill.
 * A key present in `overrides` always wins (even an explicit empty string, e.g. "keep existing"
 * was never chosen); a key NOT present leaves the existing profile value showing untouched.
 */
export function ProfileForm({
  profile,
  overrides,
  overrideVersion,
}: {
  profile: Profile | null;
  overrides?: Partial<Record<ProfileFieldName, string | null>>;
  overrideVersion?: number;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfile,
    INITIAL_PROFILE_ACTION_STATE,
  );

  function value(name: ProfileFieldName, fallback: string | null): string {
    if (overrides && name in overrides) return overrides[name] ?? '';
    return fallback ?? '';
  }

  return (
    <form key={overrideVersion ?? 0} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" name="fullName" defaultValue={value('fullName', profile?.fullName ?? null)} />
      <Field label="Headline" name="headline" defaultValue={value('headline', profile?.headline ?? null)} />
      <Field
        label="Contact email"
        name="email"
        type="email"
        defaultValue={value('email', profile?.email ?? null)}
      />
      <Field label="Phone" name="phone" defaultValue={value('phone', profile?.phone ?? null)} />
      <Field label="Location" name="location" defaultValue={value('location', profile?.location ?? null)} />
      <Field
        label="Work authorization"
        name="workAuthorization"
        defaultValue={value('workAuthorization', profile?.workAuthorization ?? null)}
      />
      <Field
        label="Relocation preference"
        name="relocationPreference"
        defaultValue={value('relocationPreference', profile?.relocationPreference ?? null)}
      />
      <Field
        label="LinkedIn"
        name="linkedin"
        type="url"
        placeholder="https://linkedin.com/in/…"
        defaultValue={value('linkedin', profile?.links.linkedin ?? null)}
      />
      <Field
        label="Portfolio"
        name="portfolio"
        type="url"
        placeholder="https://…"
        defaultValue={value('portfolio', profile?.links.portfolio ?? null)}
      />
      <Field
        label="GitHub"
        name="github"
        type="url"
        placeholder="https://github.com/…"
        defaultValue={value('github', profile?.links.github ?? null)}
      />
      <Field
        label="Website"
        name="website"
        type="url"
        placeholder="https://…"
        defaultValue={value('website', profile?.links.website ?? null)}
      />

      {state.error ? (
        <p className="text-destructive text-sm sm:col-span-2">{state.error}</p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}

export type ProfileFieldName =
  | 'fullName'
  | 'headline'
  | 'email'
  | 'phone'
  | 'location'
  | 'workAuthorization'
  | 'relocationPreference'
  | 'linkedin'
  | 'portfolio'
  | 'github'
  | 'website';

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </div>
  );
}
