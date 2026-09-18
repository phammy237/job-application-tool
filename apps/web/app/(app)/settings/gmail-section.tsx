'use client';

import { Button, Select } from '@career-os/ui';
import type { EmailConnection, EmailSignal } from '@career-os/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { formatFriendlyDateTime } from '../../../lib/format-friendly-date';

/**
 * Auto-sync-on-page-load, throttled — a documented shift from manual-only to attended
 * (docs/EMAIL_INTEGRATION.md §1, docs/USER_FLOWS.md §9): sync now runs from a manual click OR
 * this auto-check, made for this single-user deployment (see docs/IMPLEMENTATION_PLAN.md's
 * Phase 5 note on it). This is still NOT a background job: nothing runs unless a human has the
 * /settings tab open and loads/reloads it, no cron, no unattended token refresh outside a real
 * request. The throttle exists so navigating to /settings repeatedly doesn't hammer the
 * Gmail/Claude APIs on every load.
 *
 * Both are exported for testing (`isDueForAutoSync`'s throttle-boundary behavior) rather than
 * kept module-private — this doesn't change runtime behavior.
 */
export const AUTO_SYNC_THROTTLE_MS = 5 * 60 * 1000;

export function isDueForAutoSync(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;
  return Date.now() - new Date(lastSyncedAt).getTime() > AUTO_SYNC_THROTTLE_MS;
}

interface ApplicationOption {
  id: string;
  company: string;
  title: string;
}

interface SyncSummary {
  processed: number;
  autoApplied: number;
  needsConfirmation: number;
  skipped: number;
  errors: Array<{ messageId: string; message: string }>;
}

/**
 * The full connect/sync/disconnect/confirm UI for Phase 5 Gmail sync
 * (docs/IMPLEMENTATION_PLAN.md). Mirrors RequirementAnalysisPanel's client-fetch-against-the-
 * existing-API-routes pattern rather than server actions: /api/gmail/connect needs to hand back
 * a Google auth URL for the browser to navigate to, and /api/gmail/sync needs to return a rich
 * result summary to display, neither of which a plain server action models as naturally.
 * `router.refresh()` after every mutation re-runs the server component's data fetch (connection,
 * pendingSignals, applications) so this component never has to duplicate that logic client-side.
 */
export function GmailSection({
  connection,
  pendingSignals,
  applications,
}: {
  connection: EmailConnection | null;
  pendingSignals: EmailSignal[];
  applications: ApplicationOption[];
}) {
  if (!connection) {
    return <ConnectGmailButton />;
  }

  const needsReconnect = connection.status === 'ERROR' || connection.status === 'DISCONNECTED';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{connection.emailAddress}</p>
          <p className="text-muted-foreground text-xs">
            {connection.lastSyncedAt
              ? `Last synced ${formatFriendlyDateTime(connection.lastSyncedAt)}`
              : 'Never synced'}
            {needsReconnect ? (
              <span className="text-destructive"> — reconnect required</span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          {needsReconnect ? (
            <ConnectGmailButton label="Reconnect Gmail" />
          ) : (
            <SyncGmailButton lastSyncedAt={connection.lastSyncedAt} />
          )}
          <DisconnectGmailButton />
        </div>
      </div>

      {pendingSignals.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Needs your confirmation
          </h3>
          {pendingSignals.map((signal) => (
            <EmailSignalConfirmationCard
              key={signal.id}
              signal={signal}
              applications={applications}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConnectGmailButton({ label = 'Connect Gmail' }: { label?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const response = await fetch('/api/gmail/connect', { method: 'POST' });
              const body = (await response.json()) as { authUrl?: string; error?: string };
              if (!response.ok || !body.authUrl) {
                setError(body.error ?? 'Could not start the Gmail connection.');
                return;
              }
              window.location.href = body.authUrl;
            } catch {
              setError('Could not start the Gmail connection.');
            }
          });
        }}
      >
        {pending ? 'Connecting…' : label}
      </Button>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </div>
  );
}

function SyncGmailButton({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const hasAutoSyncedRef = useRef(false);

  const runSync = (auto: boolean) => {
    setError(null);
    setSummary(null);
    setAutoTriggered(auto);
    startTransition(async () => {
      try {
        const response = await fetch('/api/gmail/sync', { method: 'POST' });
        const body = (await response.json()) as SyncSummary & { error?: string };
        if (!response.ok) {
          setError(body.error ?? 'Sync failed.');
          return;
        }
        setSummary(body);
        router.refresh();
      } catch {
        setError('Sync failed.');
      }
    });
  };

  // Auto-sync on page load, throttled — see the module-level doc comment on
  // AUTO_SYNC_THROTTLE_MS. The ref is set to true right before the one attempt this mount is
  // allowed, so React 18 Strict Mode's dev-only double-invoke of this effect (or any re-render)
  // short-circuits on the second run instead of firing a second sync.
  //
  // The ref only guards this mount, though — it does not itself throttle a failed sync across
  // reloads. Whether a failed attempt retries on the next page load depends on whether the
  // failure advanced `lastSyncedAt` server-side: a refresh-token failure does (the sync route
  // stamps status: 'ERROR' + lastSyncedAt before returning), so the throttle applies normally
  // next load; other failures (e.g. a mid-sync exception) leave it untouched, so the next load
  // retries immediately — intentional, so a transient failure surfaces promptly rather than
  // sitting silently until the throttle window passes.
  useEffect(() => {
    if (hasAutoSyncedRef.current) return;
    hasAutoSyncedRef.current = true;
    if (isDueForAutoSync(lastSyncedAt)) {
      runSync(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => runSync(false)}>
        {pending ? (autoTriggered ? 'Checking for updates…' : 'Syncing…') : 'Sync Gmail'}
      </Button>
      {summary ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {autoTriggered ? 'Auto-checked' : 'Checked'} {summary.processed} message
          {summary.processed === 1 ? '' : 's'}
          {summary.autoApplied > 0 ? ` · ${summary.autoApplied} updated automatically` : ''}
          {summary.needsConfirmation > 0 ? ` · ${summary.needsConfirmation} need confirmation` : ''}
          {summary.errors.length > 0 ? ` · ${summary.errors.length} could not be processed` : ''}
          .
        </p>
      ) : null}
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </div>
  );
}

function DisconnectGmailButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm('Disconnect Gmail? This deletes all stored message signals.')) return;
        startTransition(async () => {
          await fetch('/api/gmail/disconnect', { method: 'POST' });
          router.refresh();
        });
      }}
    >
      {pending ? 'Disconnecting…' : 'Disconnect'}
    </Button>
  );
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  APPLICATION_RECEIVED: 'Application received',
  ASSESSMENT: 'Assessment',
  INTERVIEW: 'Interview',
  ACTION_REQUIRED: 'Action required',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  OTHER: 'Other',
};

function EmailSignalConfirmationCard({
  signal,
  applications,
}: {
  signal: EmailSignal;
  applications: ApplicationOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedApplicationId, setSelectedApplicationId] = useState(
    signal.matchedApplicationId ?? applications[0]?.id ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  const confirm = (action: 'CONFIRM' | 'DECLINE') => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/email-signals/${signal.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'CONFIRM' ? { action, applicationId: selectedApplicationId } : { action },
        ),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(typeof body.error === 'string' ? body.error : 'Could not save your decision.');
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="border-border bg-card space-y-2 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{signal.subject ?? '(no subject)'}</p>
        <p className="text-muted-foreground text-xs">{signal.sender ?? 'Unknown sender'}</p>
      </div>
      <p className="text-sm">
        {signal.classification ? CLASSIFICATION_LABEL[signal.classification] : 'Unclassified'}
        {signal.evidence ? ` — ${signal.evidence}` : ''}
      </p>
      {applications.length > 0 ? (
        <Select
          value={selectedApplicationId}
          onChange={(e) => setSelectedApplicationId(e.target.value)}
          disabled={pending}
        >
          {applications.map((app) => (
            <option key={app.id} value={app.id}>
              {app.company} — {app.title}
            </option>
          ))}
        </Select>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !selectedApplicationId} onClick={() => confirm('CONFIRM')}>
          Confirm
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm('DECLINE')}>
          Decline
        </Button>
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
