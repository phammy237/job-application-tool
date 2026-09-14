'use client';

import { createResumeEntryId, type ResumeBullet } from '@career-os/shared';
import { Button, Textarea } from '@career-os/ui';
import { insertAt, moveAt, removeAt, updateAt } from './array-utils';
import { MoveButtons } from './move-buttons';

/** A grounded bullet (traceable to an approved candidate fact, e.g. via a profile import) shows
 * a small non-editable badge — manual editing never silently converts it to MANUAL, but text
 * edits are still allowed (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §4: manual editing must not
 * require every bullet to already map to a fact, but also must not pretend a real provenance
 * link stopped existing just because the text changed slightly). */
function ProvenanceBadge({ bullet }: { bullet: ResumeBullet }) {
  if (bullet.provenance.type === 'MANUAL') return null;
  return (
    <span
      className="text-muted-foreground shrink-0 pt-2 text-xs"
      title="Traces back to an approved profile fact"
    >
      grounded
    </span>
  );
}

export function BulletsEditor({
  bullets,
  onChange,
}: {
  bullets: ResumeBullet[];
  onChange: (next: ResumeBullet[]) => void;
}) {
  return (
    <div className="space-y-2 pl-4">
      {bullets.map((bullet, index) => (
        <div key={bullet.id} className="flex items-start gap-2">
          <Textarea
            rows={2}
            className="text-sm"
            value={bullet.text}
            onChange={(e) =>
              onChange(updateAt(bullets, index, (b) => ({ ...b, text: e.target.value })))
            }
          />
          <ProvenanceBadge bullet={bullet} />
          <MoveButtons
            itemLabel="bullet"
            onMoveUp={() => onChange(moveAt(bullets, index, -1))}
            onMoveDown={() => onChange(moveAt(bullets, index, 1))}
            onRemove={() => onChange(removeAt(bullets, index))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange(
            insertAt(bullets, {
              id: createResumeEntryId(),
              text: '',
              provenance: { type: 'MANUAL' },
            }),
          )
        }
      >
        + Add bullet
      </Button>
    </div>
  );
}
