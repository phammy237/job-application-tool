'use client';

import { createResumeEntryId, type ResumeSkillGroup } from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { insertAt, moveAt, removeAt, updateAt } from './array-utils';
import { MoveButtons } from './move-buttons';

/**
 * Named skill groups (e.g. "Languages: Python, TypeScript"), not one flat list
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §25) — mirrors the existing `skills.category` column.
 * Items are edited as one comma-separated field per group rather than a per-item add/remove
 * control — skills lists are usually short, flat labels, so a single text field is the lower-
 * friction editing surface here (unlike bullets, which are full sentences worth editing one at a
 * time).
 */
export function SkillsEditor({
  groups,
  onChange,
}: {
  groups: ResumeSkillGroup[];
  onChange: (next: ResumeSkillGroup[]) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Skills</h3>
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">No skill groups yet.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((group, index) => (
            <div key={group.id} className="flex items-start gap-2">
              <div className="grid flex-1 grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`skill-label-${group.id}`} className="text-xs">
                    Group label
                  </Label>
                  <Input
                    id={`skill-label-${group.id}`}
                    value={group.label}
                    onChange={(e) =>
                      onChange(
                        updateAt(groups, index, (g) => ({ ...g, label: e.target.value })),
                      )
                    }
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label htmlFor={`skill-items-${group.id}`} className="text-xs">
                    Items (comma-separated)
                  </Label>
                  <Input
                    id={`skill-items-${group.id}`}
                    value={group.items.join(', ')}
                    onChange={(e) =>
                      onChange(
                        updateAt(groups, index, (g) => ({
                          ...g,
                          items: e.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })),
                      )
                    }
                  />
                </div>
              </div>
              <MoveButtons
                itemLabel="skill group"
                onMoveUp={() => onChange(moveAt(groups, index, -1))}
                onMoveDown={() => onChange(moveAt(groups, index, 1))}
                onRemove={() => onChange(removeAt(groups, index))}
              />
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange(insertAt(groups, { id: createResumeEntryId(), label: '', items: [] }))
        }
      >
        + Add skill group
      </Button>
    </section>
  );
}
