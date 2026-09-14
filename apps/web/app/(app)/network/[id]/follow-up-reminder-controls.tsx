'use client';

import { fromDatetimeLocalValue, toDatetimeLocalValue } from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { clearContactFollowUpAction, setContactFollowUpAction } from '../actions';

/**
 * The interactive half of the contact detail page's follow-up reminder section
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §12) — the factual summary text ("Follow up on Sep
 * 20", "Follow-up reminder due") is rendered by the server component in `page.tsx`, not here;
 * this only ever renders static buttons until the user explicitly opens the date/time form,
 * which is why it needs no mount-gating for a hydration-safe default (unlike `InteractionForm`,
 * whose date field is visible from first render) — the datetime-local input doesn't exist at all
 * until a post-hydration click sets `editing`, so its default is always computed in the actual
 * browser.
 */
export function FollowUpReminderControls({
  contactId,
  followUpAt,
  isDue,
}: {
  contactId: string;
  followUpAt: string | null;
  isDue: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(() =>
    toDatetimeLocalValue(followUpAt ?? new Date().toISOString()),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await setContactFollowUpAction(contactId, {
      followUpAt: fromDatetimeLocalValue(localValue),
    });
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function handleClear() {
    setPending(true);
    await clearContactFollowUpAction(contactId);
    setPending(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="follow-up-at-input">Follow up on</Label>
          <Input
            id="follow-up-at-input"
            type="datetime-local"
            required
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        {error ? <p className="text-destructive w-full text-sm">{error}</p> : null}
      </form>
    );
  }

  if (!followUpAt) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setLocalValue(toDatetimeLocalValue(new Date().toISOString()));
          setEditing(true);
        }}
      >
        Set follow-up reminder
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isDue ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => void handleClear()}
        >
          {pending ? 'Marking done…' : 'Mark done'}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setLocalValue(toDatetimeLocalValue(followUpAt));
          setEditing(true);
        }}
      >
        {isDue ? 'Reschedule' : 'Change'}
      </Button>
      {!isDue ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => void handleClear()}
        >
          {pending ? 'Clearing…' : 'Clear'}
        </Button>
      ) : null}
    </div>
  );
}
