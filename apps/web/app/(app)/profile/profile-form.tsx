import type { Profile } from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { updateProfile } from './actions';

export function ProfileForm({ profile }: { profile: Profile | null }) {
  return (
    <form action={updateProfile} className="grid gap-4 sm:grid-cols-2">
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
        defaultValue={profile?.links.linkedin ?? ''}
      />
      <Field
        label="Portfolio"
        name="portfolio"
        defaultValue={profile?.links.portfolio ?? ''}
      />
      <Field label="GitHub" name="github" defaultValue={profile?.links.github ?? ''} />
      <Field label="Website" name="website" defaultValue={profile?.links.website ?? ''} />

      <div className="sm:col-span-2">
        <Button type="submit">Save profile</Button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} />
    </div>
  );
}
