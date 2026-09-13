'use client';

import {
  APPLICATION_CONTACT_ROLES,
  type ApplicationContactRole,
  type ApplicationStatus,
} from '@career-os/shared';
import { Button, Select } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { linkContactToApplicationAction } from '../actions';
import { formatEnumLabel } from '../contact-tag-badges';

interface ApplicationOption {
  id: string;
  company: string;
  title: string;
  status: ApplicationStatus;
}

/** The contact detail page's "link to an application" affordance
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §16/§20) — the reverse direction of the application
 * People section's "link existing contact", picking an application instead of a contact. This
 * dataset (the user's own applications) is expected to stay small, so a plain `<select>` over
 * every application is the same "no special search infra needed" posture as §14. */
export function LinkApplicationForm({
  contactId,
  applications,
}: {
  contactId: string;
  applications: ApplicationOption[];
}) {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? '');
  const [role, setRole] = useState<ApplicationContactRole>(APPLICATION_CONTACT_ROLES[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (applications.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No applications to link yet — add one from the Applications page first.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] space-y-1.5">
        <Select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
          {applications.map((app) => (
            <option key={app.id} value={app.id}>
              {app.company} — {app.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Select value={role} onChange={(e) => setRole(e.target.value as ApplicationContactRole)}>
          {APPLICATION_CONTACT_ROLES.map((r) => (
            <option key={r} value={r}>
              {formatEnumLabel(r)}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await linkContactToApplicationAction(applicationId, contactId, role);
            if (result.status === 'error') {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? 'Linking…' : 'Link'}
      </Button>
      {error ? <p className="text-destructive w-full text-sm">{error}</p> : null}
    </div>
  );
}
