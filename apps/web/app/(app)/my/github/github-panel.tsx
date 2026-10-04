'use client';

import { Button, Input, Label } from '@career-os/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { EmptyState, FlagBadge } from '../_components/badges';
import {
  coerceStats,
  describeApiError,
  isPlausibleLogin,
  rateLimitMessage,
  summarizeSync,
  type SyncResponse,
} from './sync-messages';

export interface ConnectionView {
  githubLogin: string;
  hasToken: boolean;
  status: 'CONNECTED' | 'ERROR' | 'REVOKED';
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface RepoView {
  id: string;
  fullName: string;
  htmlUrl: string;
  primaryLanguage: string | null;
  stars: number;
  pushedAt: string | null;
  isPrivate: boolean;
  selected: boolean;
  projectId: string | null;
  syncStatus: 'PENDING' | 'SYNCED' | 'ERROR';
  syncError: string | null;
}

export interface RunView {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  stats: Record<string, unknown>;
}

type Message = { kind: 'ok' | 'error'; text: string } | null;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

export function GithubPanel({
  connection,
  repos,
  runs,
}: {
  connection: ConnectionView | null;
  repos: RepoView[];
  runs: RunView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null);
  const [message, setMessage] = useState<Message>(null);
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function onConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const login = String(data.get('login') ?? '').trim();
    const token = String(data.get('token') ?? '').trim();
    if (!isPlausibleLogin(login)) {
      setMessage({ kind: 'error', text: 'Enter a valid GitHub username.' });
      return;
    }
    setBusy('connect');
    setMessage(null);
    try {
      const res = await postJson('/api/myos/github/connect', token ? { login, token } : { login });
      if (!res.ok) {
        setMessage({ kind: 'error', text: describeApiError(res.status, res.json) });
        return;
      }
      form.reset(); // clears the token field; it is never kept in component state
      setMessage({ kind: 'ok', text: `Connected as ${login}. Run a sync to import repositories.` });
      refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Network error. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function onSync() {
    setBusy('sync');
    setMessage(null);
    setSyncResult(null);
    try {
      const res = await postJson('/api/myos/github/sync');
      if (!res.ok) {
        setMessage({ kind: 'error', text: describeApiError(res.status, res.json) });
        return;
      }
      const body = res.json as Partial<SyncResponse> | null;
      const result: SyncResponse = {
        runId: String(body?.runId ?? ''),
        status: (body?.status as SyncResponse['status']) ?? 'FAILED',
        stats: coerceStats(body?.stats),
        error: typeof body?.error === 'string' ? body.error : null,
      };
      setSyncResult(result);
      setMessage({
        kind: result.status === 'FAILED' ? 'error' : 'ok',
        text:
          result.status === 'SUCCEEDED'
            ? 'Sync finished.'
            : result.status === 'PARTIAL'
              ? 'Sync finished with some repositories skipped.'
              : `Sync failed${result.error ? `: ${result.error}` : '.'}`,
      });
      refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Network error during sync. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function onDisconnect() {
    setBusy('disconnect');
    setMessage(null);
    try {
      const res = await postJson('/api/myos/github/disconnect');
      if (!res.ok) {
        setMessage({ kind: 'error', text: describeApiError(res.status, res.json) });
        return;
      }
      setConfirmDisconnect(false);
      setMessage({
        kind: 'ok',
        text: 'Disconnected. The stored token was removed; imported projects and evidence were kept.',
      });
      refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Network error. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function onToggle(repo: RepoView, next: boolean) {
    setRowBusy(repo.id);
    setMessage(null);
    setSelected((s) => ({ ...s, [repo.id]: next }));
    try {
      const res = await postJson(`/api/myos/github/repositories/${repo.id}/select`, { selected: next });
      if (!res.ok) {
        setSelected((s) => ({ ...s, [repo.id]: !next }));
        setMessage({ kind: 'error', text: describeApiError(res.status, res.json) });
        return;
      }
      setMessage({
        kind: 'ok',
        text: next
          ? `${repo.fullName} selected. ${repo.projectId ? '' : 'It was imported as a private, unapproved project.'}`.trim()
          : `${repo.fullName} unselected. Any project already created is kept.`,
      });
      refresh();
    } catch {
      setSelected((s) => ({ ...s, [repo.id]: !next }));
      setMessage({ kind: 'error', text: 'Network error. Try again.' });
    } finally {
      setRowBusy(null);
    }
  }

  const working = busy !== null || isPending;
  const syncLimit = syncResult ? rateLimitMessage(syncResult.stats) : null;

  return (
    <div className="space-y-4">
      <div aria-live="polite" role="status" className="min-h-0">
        {message ? (
          <p
            role={message.kind === 'error' ? 'alert' : undefined}
            className={
              message.kind === 'error'
                ? 'border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm'
                : 'border-border bg-accent text-accent-foreground rounded-md border px-3 py-2 text-sm'
            }
          >
            {message.text}
          </p>
        ) : null}
      </div>

      {/* Connection */}
      <section aria-labelledby="gh-conn" className="border-border bg-card space-y-3 rounded-lg border p-4">
        <h2 id="gh-conn" className="text-sm font-semibold">
          Connection
        </h2>

        {connection ? (
          <div className="space-y-3">
            <p className="text-sm">
              Connected as <span className="font-medium">{connection.githubLogin}</span>.{' '}
              {connection.hasToken
                ? 'A read-only token is stored (encrypted); private repositories you selected can be read.'
                : 'No token: public repositories only.'}{' '}
              Last sync: {day(connection.lastSyncedAt)}.
            </p>
            {connection.status !== 'CONNECTED' || connection.lastError ? (
              <p className="text-destructive text-sm" role="alert">
                Connection status {connection.status.toLowerCase()}
                {connection.lastError ? `: ${connection.lastError}` : ''}. Reconnect below.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={onSync} disabled={working} aria-busy={busy === 'sync'}>
                {busy === 'sync' ? 'Syncing… this can take a minute' : 'Sync now'}
              </Button>
              {confirmDisconnect ? (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  Remove the connection and stored token?
                  <Button size="sm" variant="destructive" onClick={onDisconnect} disabled={working}>
                    {busy === 'disconnect' ? 'Disconnecting…' : 'Yes, disconnect'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)} disabled={working}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirmDisconnect(true)} disabled={working}>
                  Disconnect
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Not connected. Enter your GitHub username to import repositories as project candidates.
            Nothing is imported until you select a repository.
          </p>
        )}

        {syncResult ? (
          <div className="border-border space-y-1 rounded-md border p-3 text-sm" aria-label="Latest sync result">
            <p className="font-medium">
              Result: {syncResult.status.toLowerCase()}
            </p>
            <p className="text-muted-foreground">{summarizeSync(syncResult.stats)}</p>
            {syncLimit ? <p role="alert" className="text-amber-900">{syncLimit}</p> : null}
          </div>
        ) : null}

        <form onSubmit={onConnect} className="border-border grid gap-3 border-t pt-3 sm:grid-cols-2">
          <p className="text-sm font-medium sm:col-span-2">
            {connection ? 'Reconnect or change account' : 'Connect GitHub'}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="gh-login">GitHub username</Label>
            <Input
              id="gh-login"
              name="login"
              required
              maxLength={39}
              autoComplete="off"
              spellCheck={false}
              defaultValue={connection?.githubLogin ?? ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gh-token">Access token (optional)</Label>
            <Input
              id="gh-token"
              name="token"
              type="password"
              maxLength={255}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="gh-token-help"
            />
          </div>
          <p id="gh-token-help" className="text-muted-foreground text-xs sm:col-span-2">
            Token is encrypted at rest, only needed for private repos, read-only scopes. Use a
            fine-grained token with read-only access to contents and metadata. Leave blank for public
            repositories only.
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" variant="outline" disabled={working} aria-busy={busy === 'connect'}>
              {busy === 'connect' ? 'Connecting…' : connection ? 'Reconnect' : 'Connect'}
            </Button>
          </div>
        </form>
      </section>

      {/* Repositories */}
      <section aria-labelledby="gh-repos" className="border-border bg-card space-y-3 rounded-lg border p-4">
        <h2 id="gh-repos" className="text-sm font-semibold">
          Repositories
        </h2>
        {repos.length === 0 ? (
          <EmptyState
            title="No repositories yet"
            description={
              connection
                ? 'Run “Sync now” to list your repositories.'
                : 'Connect GitHub, then sync to list your repositories.'
            }
          />
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              Selecting a repository imports it as a private, unapproved project and deep-syncs it. You
              approve it later.
            </p>
            <ul className="divide-border divide-y">
              {repos.map((repo) => {
                const checked = selected[repo.id] ?? repo.selected;
                return (
                  <li
                    key={repo.id}
                    className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 py-2.5 text-sm md:grid-cols-[minmax(0,2fr)_7rem_4rem_6rem_minmax(0,1.5fr)_8rem] md:items-center"
                  >
                    <div className="min-w-0">
                      <a
                        href={repo.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline focus-visible:underline"
                      >
                        {repo.fullName}
                      </a>
                      {repo.isPrivate ? (
                        <span className="ml-2 inline-block align-middle">
                          <FlagBadge tone="neutral">Private</FlagBadge>
                        </span>
                      ) : null}
                      {repo.projectId ? (
                        <Link href={`/my/projects/${repo.projectId}`} className="text-primary ml-2 text-xs hover:underline">
                          Open project
                        </Link>
                      ) : null}
                    </div>
                    <label className="flex items-center gap-2 justify-self-end md:order-last md:justify-self-start">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={working || rowBusy === repo.id}
                        onChange={(e) => onToggle(repo, e.target.checked)}
                        aria-label={`Import ${repo.fullName} as a project`}
                      />
                      <span className="text-xs">{rowBusy === repo.id ? 'Saving…' : 'Import as project'}</span>
                    </label>
                    <span className="text-muted-foreground col-span-2 flex flex-wrap gap-x-3 text-xs md:contents md:text-sm">
                      <span>{repo.primaryLanguage ?? '—'}</span>
                      <span>{repo.stars} ★</span>
                      <span>Pushed {day(repo.pushedAt)}</span>
                      <span className={repo.syncStatus === 'ERROR' ? 'text-destructive' : undefined}>
                        {repo.syncStatus === 'ERROR'
                          ? `Error: ${repo.syncError ?? 'sync failed'}`
                          : repo.syncStatus === 'SYNCED'
                            ? 'Synced'
                            : 'Not synced'}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* History */}
      <section aria-labelledby="gh-runs" className="border-border bg-card space-y-3 rounded-lg border p-4">
        <h2 id="gh-runs" className="text-sm font-semibold">
          Recent sync runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No syncs yet.</p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {runs.map((run) => {
              const stats = coerceStats(run.stats);
              return (
                <li key={run.id} className="py-2">
                  <p>
                    <span className="font-medium">{day(run.startedAt)}</span>{' '}
                    <span className="text-muted-foreground">{run.status.toLowerCase()}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">{summarizeSync(stats)}</p>
                  {run.error ? <p className="text-destructive text-xs">{run.error}</p> : null}
                  {rateLimitMessage(stats) ? (
                    <p className="text-xs text-amber-900">{rateLimitMessage(stats)}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
