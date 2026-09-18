'use client';

import type { Skill } from '@career-os/shared';
import { Badge, Button, Input } from '@career-os/ui';
import { useActionState, useState } from 'react';
import type { PendingSkill } from '../../../lib/resume-import/pending-types';
import { addSkill, deleteSkill } from './actions';
import { INITIAL_PROFILE_ACTION_STATE } from './profile-action-state';

export function SkillSection({
  skills,
  pendingItems = [],
  onPendingRemove,
  onPendingRemoveAll,
}: {
  skills: Skill[];
  pendingItems?: PendingSkill[];
  onPendingRemove?: (key: string) => void;
  onPendingRemoveAll?: (keys: string[]) => void;
}) {
  const [addState, addFormAction, addPending] = useActionState(
    addSkill,
    INITIAL_PROFILE_ACTION_STATE,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveAll() {
    if (saving || pendingItems.length === 0) return; // duplicate-click guard
    setSaving(true);
    setError(null);
    const saved: string[] = [];
    for (const item of pendingItems) {
      const fd = new FormData();
      fd.set('name', item.name);
      const result = await addSkill(INITIAL_PROFILE_ACTION_STATE, fd);
      if (result.error) {
        setError(result.error);
        break;
      }
      saved.push(item.key);
    }
    onPendingRemoveAll?.(saved);
    setSaving(false);
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Skills</h2>

      {pendingItems.length > 0 ? (
        <div className="border-primary/40 bg-primary/5 space-y-3 rounded-lg border p-4">
          <p className="text-primary text-xs font-medium">Imported from résumé — not yet saved</p>
          <div className="flex flex-wrap gap-2">
            {pendingItems.map((item) => (
              <Badge key={item.key} variant="secondary" className="gap-1.5">
                {item.name}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onPendingRemove?.(item.key)}
                  aria-label={`Discard ${item.name}`}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <Button type="button" size="sm" disabled={saving} onClick={() => void handleSaveAll()}>
            {saving ? 'Saving…' : `Save ${pendingItems.length} skill(s) to profile`}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {skills.map((skill) => (
          <SkillChip key={skill.id} skill={skill} />
        ))}
        {skills.length === 0 && pendingItems.length === 0 ? (
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
