'use client';

import type { Project } from '@career-os/shared';
import { Button, Input, Label, Textarea } from '@career-os/ui';
import { useActionState, useState } from 'react';
import { PendingImportCard } from '../../../lib/resume-import/pending-import-card';
import type { PendingProject } from '../../../lib/resume-import/pending-types';
import { ApprovalCheckboxes } from './approval-checkboxes';
import { addProject, deleteProject, updateProjectApproval } from './actions';
import { BulletedDescription } from './bulleted-description';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

export function ProjectSection({
  projects,
  pendingItems = [],
  onPendingChange,
  onPendingRemove,
}: {
  projects: Project[];
  pendingItems?: PendingProject[];
  onPendingChange?: (key: string, next: PendingProject) => void;
  onPendingRemove?: (key: string) => void;
}) {
  const [addState, addFormAction, addPending] = useActionState(
    addProject,
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Projects</h2>

      <div className="space-y-3">
        {pendingItems.map((item) => (
          <PendingProjectCard
            key={item.key}
            item={item}
            onChange={(next) => onPendingChange?.(item.key, next)}
            onRemove={() => onPendingRemove?.(item.key)}
          />
        ))}
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
        {projects.length === 0 && pendingItems.length === 0 ? (
          <p className="text-muted-foreground text-sm">No projects added yet.</p>
        ) : null}
      </div>

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Add project</summary>
        <form action={addFormAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Name</Label>
            <Input id="proj-name" name="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-role">Role</Label>
            <Input id="proj-role" name="role" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-url">URL</Label>
            <Input id="proj-url" name="url" type="url" placeholder="https://…" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="proj-description">Description</Label>
            <Textarea id="proj-description" name="description" rows={3} />
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
              {addPending ? 'Adding…' : 'Add project'}
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteProject.bind(null, project.id),
    INITIAL_PROFILE_ACTION_STATE,
  );
  const [approvalState, approvalAction, approvalPending] = useActionState(
    updateProjectApproval.bind(null, project.id),
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{project.name}</p>
          {project.description ? <BulletedDescription description={project.description} /> : null}
        </div>
        <form action={deleteAction}>
          <Button type="submit" variant="ghost" size="sm" disabled={deletePending}>
            {deletePending ? 'Deleting…' : 'Delete'}
          </Button>
        </form>
      </div>
      <form action={approvalAction} className="mt-3 flex items-center justify-between gap-4">
        <ApprovalCheckboxes
          defaultApproved={project.userApproved}
          defaultApprovedForApplications={project.approvedForApplications}
          defaultVisible={project.visibleOnPublicProfile}
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

/** See experience-section.tsx's `PendingExperienceCard` doc comment — identical approval-event
 * reasoning applies here. */
function PendingProjectCard({
  item,
  onChange,
  onRemove,
}: {
  item: PendingProject;
  onChange: (next: PendingProject) => void;
  onRemove: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (saving) return; // duplicate-click guard
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.set('name', item.name);
    fd.set('role', item.role ?? '');
    fd.set('url', item.url ?? '');
    fd.set('description', item.description ?? '');
    fd.set('userApproved', 'on');
    fd.set('approvedForApplications', 'on');
    const result = await addProject(INITIAL_PROFILE_ACTION_STATE, fd);
    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }
    onRemove();
  }

  return (
    <PendingImportCard
      saving={saving}
      error={error}
      onSave={() => void handleSave()}
      onDiscard={onRemove}
      fields={[
        { label: 'Name', value: item.name, onChange: (v) => onChange({ ...item, name: v }) },
        { label: 'Role', value: item.role ?? '', onChange: (v) => onChange({ ...item, role: v || null }) },
        { label: 'URL', value: item.url ?? '', onChange: (v) => onChange({ ...item, url: v || null }) },
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
