'use client';

import type { Profile } from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { useActionState } from 'react';
import { updateProfile } from './actions';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const [state, formAction, pending] = useActionState(
    updateProfile,
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" name="fullName" defaultValue={profile?.fullName ?? ''} />
      <Field label="Headline" name="headline" defaultValue={profile?.headline ?? ''} />
      <Field
        label="Contact email"
        name="email"
        type="email"
        defaultValue={profile?.email ?? ''}
      />
      <Field label="Phone" name="phone" defaultValue={profile?.phone ?? ''} />
      <Field label="Location" name="location" defaultValue={profile?.location ?? ''} />
      <Field
        label="Work authorization"
        name="workAuthorization"
        defaultValue={profile?.workAuthorization ?? ''}
      />
      <Field
        label="Relocation preference"
        name="relocationPreference"
        defaultValue={profile?.relocationPreference ?? ''}
      />
      <Field
        label="LinkedIn"
        name="linkedin"
        type="url"
        placeholder="https://linkedin.com/in/…"
        defaultValue={profile?.links.linkedin ?? ''}
      />
      <Field
        label="Portfolio"
        name="portfolio"
        type="url"
        placeholder="https://…"
        defaultValue={profile?.links.portfolio ?? ''}
      />
      <Field
        label="GitHub"
        name="github"
        type="url"
        placeholder="https://github.com/…"
        defaultValue={profile?.links.github ?? ''}
      />
      <Field
        label="Website"
        name="website"
        type="url"
        placeholder="https://…"
        defaultValue={profile?.links.website ?? ''}
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
