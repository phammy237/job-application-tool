'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Auto Mode toggle (migration 0047, D9 Phase A) — own section, not folded into the Gmail card,
 * since Auto Mode has nothing to do with Gmail. Mirrors `BackgroundTrackingToggle`'s
 * fetch-the-route-then-`router.refresh()` shape (gmail-section.tsx) rather than a server action,
 * for the same reason: a plain checkbox with an immediate optimistic flip and a clear error
 * message on failure.
 */
export function AutoModeSection({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !enabled;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/auto-mode/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'Could not update this setting.');
          return;
        }
        setEnabled(next);
        router.refresh();
      } catch {
        setError('Could not update this setting.');
      }
    });
  };

  return (
    <div className="border-border bg-card rounded-lg border p-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={toggle}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">Auto-queue high-match jobs</span>
          <span className="text-muted-foreground block text-xs">
            Career OS will automatically save high-match jobs from your Discover feed as
            ordinary tracked applications for you to review — it never fills a form or submits
            anything. Review and keep or dismiss each one from your dashboard. Off by default;
            manually adding or starting applications from Discover still works either way.
          </span>
        </span>
      </label>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </div>
  );
}
