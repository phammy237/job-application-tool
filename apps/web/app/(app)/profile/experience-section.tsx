'use client';

import type { Experience } from '@career-os/shared';
import { Button, Input, Label, Textarea } from '@career-os/ui';
import { useActionState, useState } from 'react';
import { PendingImportCard } from '../../../lib/resume-import/pending-import-card';
import type { PendingExperience } from '../../../lib/resume-import/pending-types';
import { ApprovalCheckboxes } from './approval-checkboxes';
import { addExperience, deleteExperience, updateExperienceApproval } from './actions';
import { BulletedDescription } from './bulleted-description';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

export function ExperienceSection({
  experiences,
  pendingItems = [],
  onPendingChange,
  onPendingRemove,
}: {
  experiences: Experience[];
  pendingItems?: PendingExperience[];
  onPendingChange?: (key: string, next: PendingExperience) => void;
  onPendingRemove?: (key: string) => void;
}) {
  const [addState, addFormAction, addPending] = useActionState(
    addExperience,
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Experience</h2>

      <div className="space-y-3">
        {pendingItems.map((item) => (
          <PendingExperienceCard
            key={item.key}
            item={item}
            onChange={(next) => onPendingChange?.(item.key, next)}
            onRemove={() => onPendingRemove?.(item.key)}
          />
        ))}
        {experiences.map((experience) => (
          <ExperienceRow key={experience.id} experience={experience} />
        ))}
        {experiences.length === 0 && pendingItems.length === 0 ? (
          <p className="text-muted-foreground text-sm">No experience added yet.</p>
        ) : null}
      </div>

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Add experience</summary>
        <form action={addFormAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-company">Company</Label>
            <Input id="exp-company" name="company" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-title">Title</Label>
            <Input id="exp-title" name="title" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-location">Location</Label>
            <Input id="exp-location" name="location" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-employmentType">Employment type</Label>
            <Input
              id="exp-employmentType"
              name="employmentType"
              placeholder="Full-time"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-startDate">Start date</Label>
            <Input id="exp-startDate" name="startDate" type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-endDate">End date</Label>
            <Input id="exp-endDate" name="endDate" type="date" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="exp-description">Description</Label>
            <Textarea id="exp-description" name="description" rows={3} />
          </div>
          <div className="sm:col-span-2">
            <ApprovalCheckboxes
              defaultApproved={false}
              defaultApprovedForApplications={false}
              defaultVisible={false}
            />
          </div>
          {addState.error ? (
            <p className="text-destructive text-sm sm:col-span-2">{addState.error}</p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={addPending}>
              {addPending ? 'Adding…' : 'Add experience'}
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}

function ExperienceRow({ experience }: { experience: Experience }) {
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteExperience.bind(null, experience.id),
    INITIAL_PROFILE_ACTION_STATE,
  );
  const [approvalState, approvalAction, approvalPending] = useActionState(
    updateExperienceApproval.bind(null, experience.id),
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">
            {experience.title} · {experience.company}
          </p>
          <p className="text-muted-foreground text-sm">
            {[experience.location, experience.employmentType].filter(Boolean).join(' · ')}
          </p>
          {experience.description ? (
            <BulletedDescription description={experience.description} />
          ) : null}
        </div>
        <form action={deleteAction}>
          <Button type="submit" variant="ghost" size="sm" disabled={deletePending}>
            {deletePending ? 'Deleting…' : 'Delete'}
          </Button>
        </form>
      </div>
      <form action={approvalAction} className="mt-3 flex items-center justify-between gap-4">
        <ApprovalCheckboxes
          defaultApproved={experience.userApproved}
          defaultApprovedForApplications={experience.approvedForApplications}
          defaultVisible={experience.visibleOnPublicProfile}
        />
        <Button type="submit" variant="outline" size="sm" disabled={approvalPending}>
          {approvalPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
      {deleteState.error ? <p className="text-destructive mt-1 text-xs">{deleteState.error}</p> : null}
      {approvalState.error ? (
        <p className="text-destructive mt-1 text-xs">{approvalState.error}</p>
      ) : null}
    </div>
  );
}

/**
 * A staged, résumé-imported experience row — "Save to profile" calls the exact same `addExperience`
 * server action the manual "Add experience" form above uses (same schema, same validation), so
 * persistence never diverges from this section's existing save path. Reviewed-and-confirmed
 * résumé facts are approved the moment the user explicitly saves them here — the same "review,
 * optionally edit, explicitly confirm" approval event already established for
 * /settings/resume-import's Confirm Import (see confirm/route.ts's own doc comment) — never the
 * manual add-form's own unapproved-by-default behavior, which is for a fact the user is typing in
 * for the first time with no prior review step behind it.
 */
function PendingExperienceCard({
  item,
  onChange,
  onRemove,
}: {
  item: PendingExperience;
  onChange: (next: PendingExperience) => void;
  onRemove: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (saving) return; // duplicate-click guard
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.set('company', item.company);
    fd.set('title', item.title);
    fd.set('location', item.location ?? '');
    fd.set('description', item.description ?? '');
    fd.set('employmentType', '');
    fd.set('startDate', '');
    fd.set('endDate', '');
    fd.set('userApproved', 'on');
    fd.set('approvedForApplications', 'on');
    const result = await addExperience(INITIAL_PROFILE_ACTION_STATE, fd);
    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }
    onRemove();
  }

  return (
    <PendingImportCard
      note={item.dateRangeText ? `Dates on résumé: ${item.dateRangeText}` : undefined}
      saving={saving}
      error={error}
      onSave={() => void handleSave()}
      onDiscard={onRemove}
      fields={[
        { label: 'Company', value: item.company, onChange: (v) => onChange({ ...item, company: v }) },
        { label: 'Title', value: item.title, onChange: (v) => onChange({ ...item, title: v }) },
        {
          label: 'Location',
          value: item.location ?? '',
          onChange: (v) => onChange({ ...item, location: v || null }),
        },
        {
          label: 'Description',
          value: item.description ?? '',
          onChange: (v) => onChange({ ...item, description: v || null }),
          multiline: true,
        },
      ]}
    />
  );
}
