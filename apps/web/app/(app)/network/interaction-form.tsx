'use client';

import {
  CONTACT_INTERACTION_TYPES,
  INTERACTION_DIRECTIONS,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  type ContactInteractionType,
  type InteractionDirection,
} from '@career-os/shared';
import { Button, Label, Select, Textarea, Input } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createInteractionAction, updateInteractionAction } from './actions';
import { formatEnumLabel } from './contact-tag-badges';

export interface InteractionApplicationOption {
  id: string;
  company: string;
  title: string;
}

export interface InteractionFormInitialValues {
  interactionType: ContactInteractionType;
  occurredAt: string;
  direction: InteractionDirection | null;
  subject: string | null;
  notes: string | null;
  applicationId: string | null;
}

interface InteractionFormProps {
  contactId: string;
  mode: 'create' | 'edit';
  /** Required for mode "edit". */
  interactionId?: string;
  initialValues?: InteractionFormInitialValues;
  /** Only the applications already linked to *this* contact — Phase 6B v1 requires an
   * interaction's optional application context to be one the contact is actually linked to
   * (docs/IMPLEMENTATION_PLAN.md "Phase 6B" §12), so the picker never offers an unrelated one. */
  linkedApplications: InteractionApplicationOption[];
  onSuccess?: () => void;
}

/**
 * "Log interaction" (create) / "Edit interaction" (edit) form for a contact's timeline
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6B"). No duplicate check (unlike `ContactForm`) —
 * interaction history is factual record-keeping, not a second identity to dedupe.
 *
 * The date/time field renders a placeholder until mounted, then fills in a *local*-time default
 * (now, for a new interaction; the existing value, converted, for an edit) — computing that
 * conversion during server rendering would use the server's timezone, not the browser's, and
 * risk a hydration mismatch (docs/IMPLEMENTATION_PLAN.md "Phase 6B" §25).
 */
export function InteractionForm({
  contactId,
  mode,
  interactionId,
  initialValues,
  linkedApplications,
  onSuccess,
}: InteractionFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [mounted, setMounted] = useState(false);
  const [occurredAtLocal, setOccurredAtLocal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOccurredAtLocal(
      toDatetimeLocalValue(initialValues?.occurredAt ?? new Date().toISOString()),
    );
    setMounted(true);
    // Only ever recompute this default on the initial mount — re-running it on every re-render
    // would keep resetting a "create" form's date back to "now" as the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);

    const input = {
      interactionType: data.get('interactionType'),
      occurredAt: fromDatetimeLocalValue(data.get('occurredAtLocal') as string),
      direction: (data.get('direction') as string) || null,
      subject: (data.get('subject') as string) || '',
      notes: (data.get('notes') as string) || '',
      applicationId: (data.get('applicationId') as string) || null,
    };

    setSubmitting(true);
    setError(null);
    const result =
      mode === 'create'
        ? await createInteractionAction(contactId, input)
        : await updateInteractionAction(contactId, interactionId as string, input);
    setSubmitting(false);

    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    if (mode === 'create') {
      form.reset();
      setOccurredAtLocal(toDatetimeLocalValue(new Date().toISOString()));
    }
    router.refresh();
    onSuccess?.();
  }

  if (!mounted) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-${interactionId ?? 'new'}-interactionType`}>
          Type *
        </Label>
        <Select
          id={`${mode}-${interactionId ?? 'new'}-interactionType`}
          name="interactionType"
          required
          defaultValue={initialValues?.interactionType ?? CONTACT_INTERACTION_TYPES[0]}
        >
          {CONTACT_INTERACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {formatEnumLabel(type)}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-${interactionId ?? 'new'}-occurredAtLocal`}>
          Date/time *
        </Label>
        <Input
          id={`${mode}-${interactionId ?? 'new'}-occurredAtLocal`}
          name="occurredAtLocal"
          type="datetime-local"
          required
          value={occurredAtLocal}
          onChange={(e) => setOccurredAtLocal(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-${interactionId ?? 'new'}-direction`}>Direction</Label>
        <Select
          id={`${mode}-${interactionId ?? 'new'}-direction`}
          name="direction"
          defaultValue={initialValues?.direction ?? ''}
        >
          <option value="">—</option>
          {INTERACTION_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {formatEnumLabel(d)}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-${interactionId ?? 'new'}-applicationId`}>
          Related application
        </Label>
        <Select
          id={`${mode}-${interactionId ?? 'new'}-applicationId`}
          name="applicationId"
          defaultValue={initialValues?.applicationId ?? ''}
        >
          <option value="">None</option>
          {linkedApplications.map((app) => (
            <option key={app.id} value={app.id}>
              {app.company} — {app.title}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${mode}-${interactionId ?? 'new'}-subject`}>Subject</Label>
        <Input
          id={`${mode}-${interactionId ?? 'new'}-subject`}
          name="subject"
          defaultValue={initialValues?.subject ?? ''}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${mode}-${interactionId ?? 'new'}-notes`}>Notes</Label>
        <Textarea
          id={`${mode}-${interactionId ?? 'new'}-notes`}
          name="notes"
          rows={3}
          defaultValue={initialValues?.notes ?? ''}
        />
      </div>

      {error ? <p className="text-destructive text-sm sm:col-span-2">{error}</p> : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={submitting}>
          {submitting
            ? 'Saving…'
            : mode === 'create'
              ? 'Log interaction'
              : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
