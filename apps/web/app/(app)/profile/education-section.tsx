import type { Education } from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { ApprovalCheckboxes } from './approval-checkboxes';
import { addEducation, deleteEducation, updateEducationApproval } from './actions';

export function EducationSection({ education }: { education: Education[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Education</h2>

      <div className="space-y-3">
        {education.map((item) => (
          <div key={item.id} className="border-border bg-card rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{item.school}</p>
                <p className="text-muted-foreground text-sm">
                  {[item.degree, item.fieldOfStudy].filter(Boolean).join(', ')}
                </p>
              </div>
              <form action={deleteEducation.bind(null, item.id)}>
                <Button type="submit" variant="ghost" size="sm">
                  Delete
                </Button>
              </form>
            </div>
            <form
              action={updateEducationApproval.bind(null, item.id)}
              className="mt-3 flex items-center justify-between gap-4"
            >
              <ApprovalCheckboxes
                defaultApproved={item.userApproved}
                defaultApprovedForApplications={item.approvedForApplications}
                defaultVisible={item.visibleOnPublicProfile}
              />
              <Button type="submit" variant="outline" size="sm">
                Save
              </Button>
            </form>
          </div>
        ))}
        {education.length === 0 ? (
          <p className="text-muted-foreground text-sm">No education added yet.</p>
        ) : null}
      </div>

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Add education</summary>
        <form action={addEducation} className="mt-4 grid gap-3 sm:grid-cols-2">
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
          <div className="sm:col-span-2">
            <Button type="submit">Add education</Button>
          </div>
        </form>
      </details>
    </section>
  );
}
