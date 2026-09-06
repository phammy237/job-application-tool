'use client';

import { Button, Select } from '@career-os/ui';
import type { EmailConnection, EmailSignal } from '@career-os/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{connection.emailAddress}</p>
          <p className="text-muted-foreground text-xs">
            {connection.lastSyncedAt
              ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}`
              : 'Never synced'}
            {connection.status === 'ERROR' ? ' — last sync failed, try reconnecting' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <SyncGmailButton />
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

function ConnectGmailButton() {
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
        {pending ? 'Connecting…' : 'Connect Gmail'}
      </Button>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </div>
  );
}

function SyncGmailButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          setSummary(null);
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
        }}
      >
        {pending ? 'Syncing…' : 'Sync Gmail'}
      </Button>
      {summary ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Checked {summary.processed} message{summary.processed === 1 ? '' : 's'}
          {summary.autoApplied > 0 ? ` · ${summary.autoApplied} updated automatically` : ''}
          {summary.needsConfirmation > 0 ? ` · ${summary.needsConfirmation} need confirmation` : ''}
          {summary.errors.length > 0 ? ` · ${summary.errors.length} could not be processed` : ''}
          . Syncs your most recent messages — click again to check for more.
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
