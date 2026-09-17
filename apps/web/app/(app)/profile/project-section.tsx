'use client';

import type { Project } from '@career-os/shared';
import { Button, Input, Label, Textarea } from '@career-os/ui';
import { useActionState } from 'react';
import { ApprovalCheckboxes } from './approval-checkboxes';
import { addProject, deleteProject, updateProjectApproval } from './actions';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

export function ProjectSection({ projects }: { projects: Project[] }) {
  const [addState, addFormAction, addPending] = useActionState(
    addProject,
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Projects</h2>

      <div className="space-y-3">
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
        {projects.length === 0 ? (
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
          {project.description ? (
            <p className="text-muted-foreground mt-1 text-sm">{project.description}</p>
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
