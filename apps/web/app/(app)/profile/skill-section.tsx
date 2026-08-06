import type { Skill } from '@career-os/shared';
import { Badge, Button, Input } from '@career-os/ui';
import { addSkill, deleteSkill } from './actions';

export function SkillSection({ skills }: { skills: Skill[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Skills</h2>

      <div className="flex flex-wrap gap-2">
        {skills.map((skill) => (
          <form key={skill.id} action={deleteSkill.bind(null, skill.id)}>
            <button type="submit" className="group">
              <Badge variant="secondary" className="gap-1.5">
                {skill.name}
                <span className="text-muted-foreground group-hover:text-destructive">
                  ×
                </span>
              </Badge>
            </button>
          </form>
        ))}
        {skills.length === 0 ? (
          <p className="text-muted-foreground text-sm">No skills added yet.</p>
        ) : null}
      </div>

      <form action={addSkill} className="flex max-w-sm items-center gap-2">
        <Input name="name" placeholder="Add a skill…" required />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
    </section>
  );
}
