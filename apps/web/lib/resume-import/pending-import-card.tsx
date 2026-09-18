'use client';

import { Button, Input } from '@career-os/ui';

interface PendingField {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}

/**
 * One staged, not-yet-persisted résumé-import row rendered inline in a Candidate Profile section
 * (Experience/Education/Projects) on /profile — the autofill step never writes to the database
 * itself (CLAUDE.md-level rule for this feature); "Save to profile" is what actually calls the
 * section's existing add-action (addExperience/addEducation/addProject), so persistence keeps
 * going through the exact same Zod validation and query functions the manual "Add…" forms below
 * already use. Every field stays editable right up to that click — the user can still inspect and
 * change values here, not only back in the earlier review step.
 */
export function PendingImportCard({
  fields,
  note,
  saving,
  error,
  onSave,
  onDiscard,
}: {
  fields: PendingField[];
  note?: string;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="border-primary/40 bg-primary/5 rounded-lg border p-4">
      <p className="text-primary text-xs font-medium">Imported from résumé — not yet saved</p>
      {note ? <p className="text-muted-foreground mt-0.5 text-xs">{note}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.label} className={`space-y-1 ${field.multiline ? 'sm:col-span-2' : ''}`}>
            <label className="text-muted-foreground text-xs">{field.label}</label>
            {field.multiline ? (
              <textarea
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                rows={3}
                className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              />
            ) : (
              <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />
            )}
          </div>
        ))}
      </div>
      {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save to profile'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
