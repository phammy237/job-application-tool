'use client';

import type { Skill } from '@career-os/shared';
import { Badge, Button, Input } from '@career-os/ui';
import { useActionState } from 'react';
import { addSkill, deleteSkill } from './actions';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

export function SkillSection({ skills }: { skills: Skill[] }) {
  const [addState, addFormAction, addPending] = useActionState(
    addSkill,
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Skills</h2>

      <div className="flex flex-wrap gap-2">
        {skills.map((skill) => (
          <SkillChip key={skill.id} skill={skill} />
        ))}
        {skills.length === 0 ? (
          <p className="text-muted-foreground text-sm">No skills added yet.</p>
        ) : null}
      </div>

      <form action={addFormAction} className="flex max-w-sm items-center gap-2">
        <Input name="name" placeholder="Add a skill…" required />
        <Button type="submit" size="sm" disabled={addPending}>
          {addPending ? 'Adding…' : 'Add'}
        </Button>
      </form>
      {addState.error ? <p className="text-destructive text-sm">{addState.error}</p> : null}
    </section>
  );
}

function SkillChip({ skill }: { skill: Skill }) {
  const [, deleteAction, deletePending] = useActionState(
    deleteSkill.bind(null, skill.id),
    INITIAL_PROFILE_ACTION_STATE,
  );

  return (
    <form action={deleteAction}>
      <button type="submit" className="group" disabled={deletePending}>
        <Badge variant="secondary" className="gap-1.5">
          {skill.name}
          <span className="text-muted-foreground group-hover:text-destructive">×</span>
        </Badge>
      </button>
    </form>
  );
}
