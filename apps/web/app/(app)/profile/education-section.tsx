'use client';

import type { Education } from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { useActionState } from 'react';
import { ApprovalCheckboxes } from './approval-checkboxes';
import { addEducation, deleteEducation, updateEducationApproval } from './actions';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

export function EducationSection({ education }: { education: Education[] }) {
  const [addState, addFormAction, addPending] = useActionState(
    addEducation,
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Education</h2>

      <div className="space-y-3">
        {education.map((item) => (
          <EducationRow key={item.id} item={item} />
        ))}
        {education.length === 0 ? (
          <p className="text-muted-foreground text-sm">No education added yet.</p>
        ) : null}
      </div>

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Add education</summary>
        <form action={addFormAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edu-school">School</Label>
            <Input id="edu-school" name="school" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edu-degree">Degree</Label>
            <Input id="edu-degree" name="degree" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edu-fieldOfStudy">Field of study</Label>
            <Input id="edu-fieldOfStudy" name="fieldOfStudy" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edu-gpa">GPA</Label>
            <Input id="edu-gpa" name="gpa" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edu-startDate">Start date</Label>
            <Input id="edu-startDate" name="startDate" type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edu-graduationDate">Graduation date</Label>
            <Input id="edu-graduationDate" name="graduationDate" type="date" />
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
              {addPending ? 'Adding…' : 'Add education'}
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}

function EducationRow({ item }: { item: Education }) {
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteEducation.bind(null, item.id),
    INITIAL_PROFILE_ACTION_STATE,
  );
  const [approvalState, approvalAction, approvalPending] = useActionState(
    updateEducationApproval.bind(null, item.id),
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{item.school}</p>
          <p className="text-muted-foreground text-sm">
            {[item.degree, item.fieldOfStudy].filter(Boolean).join(', ')}
          </p>
        </div>
        <form action={deleteAction}>
          <Button type="submit" variant="ghost" size="sm" disabled={deletePending}>
            {deletePending ? 'Deleting…' : 'Delete'}
          </Button>
        </form>
      </div>
      <form action={approvalAction} className="mt-3 flex items-center justify-between gap-4">
        <ApprovalCheckboxes
          defaultApproved={item.userApproved}
          defaultApprovedForApplications={item.approvedForApplications}
          defaultVisible={item.visibleOnPublicProfile}
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
