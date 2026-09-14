'use client';

import { Button, Card, CardContent } from '@career-os/ui';
import type { ReactNode } from 'react';
import { insertAt, moveAt, removeAt, updateAt } from './array-utils';
import { MoveButtons } from './move-buttons';

/**
 * Generic add/remove/reorder list editor shared by Education, Experience, Projects, and
 * Leadership (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §22) — each section's own field layout is
 * supplied via `renderFields`, so this component only owns the list mechanics (add a new blank
 * entry, remove one, move one up/down), never the entry shape itself.
 */
export function EntrySectionEditor<T extends { id: string }>({
  title,
  entries,
  onChange,
  createBlankEntry,
  renderFields,
  entryLabel,
}: {
  title: string;
  entries: T[];
  onChange: (next: T[]) => void;
  createBlankEntry: () => T;
  renderFields: (entry: T, update: (updater: (entry: T) => T) => void) => ReactNode;
  entryLabel: string;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No {entryLabel} entries yet.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <Card key={entry.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-3">
                    {renderFields(entry, (updater) =>
                      onChange(updateAt(entries, index, updater)),
                    )}
                  </div>
                  <MoveButtons
                    itemLabel={entryLabel}
                    onMoveUp={() => onChange(moveAt(entries, index, -1))}
                    onMoveDown={() => onChange(moveAt(entries, index, 1))}
                    onRemove={() => onChange(removeAt(entries, index))}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(insertAt(entries, createBlankEntry()))}
      >
        + Add {entryLabel}
      </Button>
    </section>
  );
}
