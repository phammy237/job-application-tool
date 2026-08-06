import type { Project } from '@career-os/shared';
import { Button, Input, Label, Textarea } from '@career-os/ui';
import { ApprovalCheckboxes } from './approval-checkboxes';
import { addProject, deleteProject, updateProjectApproval } from './actions';

export function ProjectSection({ projects }: { projects: Project[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Projects</h2>

      <div className="space-y-3">
        {projects.map((project) => (
          <div key={project.id} className="border-border bg-card rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{project.name}</p>
                {project.description ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {project.description}
                  </p>
                ) : null}
              </div>
              <form action={deleteProject.bind(null, project.id)}>
                <Button type="submit" variant="ghost" size="sm">
                  Delete
                </Button>
              </form>
            </div>
            <form
              action={updateProjectApproval.bind(null, project.id)}
              className="mt-3 flex items-center justify-between gap-4"
            >
              <ApprovalCheckboxes
                defaultApproved={project.userApproved}
                defaultApprovedForApplications={project.approvedForApplications}
                defaultVisible={project.visibleOnPublicProfile}
              />
              <Button type="submit" variant="outline" size="sm">
                Save
              </Button>
            </form>
          </div>
        ))}
        {projects.length === 0 ? (
          <p className="text-muted-foreground text-sm">No projects added yet.</p>
        ) : null}
      </div>

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Add project</summary>
        <form action={addProject} className="mt-4 grid gap-3 sm:grid-cols-2">
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
            <Input id="proj-url" name="url" type="url" />
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
          <div className="sm:col-span-2">
            <Button type="submit">Add project</Button>
          </div>
        </form>
      </details>
    </section>
  );
}
