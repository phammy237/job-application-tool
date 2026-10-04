/**
 * Pure helpers that turn GitHub API route responses into user-facing text. Kept free of React and
 * server imports so the client panel and the unit tests can both use them. Nothing here ever
 * receives or prints a token.
 */

export interface SyncStatsView {
  reposListed: number;
  metadataUpserted: number;
  detailSynced: number;
  skippedUnchanged: number;
  failed: number;
  evidenceCreated: number;
  evidenceUpdated: number;
  rateLimited: boolean;
  rateLimitResetAt: string | null;
}

export interface SyncResponse {
  runId: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  stats: SyncStatsView;
  error: string | null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Defensive coercion: the stats column is free-form JSON on the history side. */
export function coerceStats(raw: unknown): SyncStatsView {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    reposListed: num(r.reposListed),
    metadataUpserted: num(r.metadataUpserted),
    detailSynced: num(r.detailSynced),
    skippedUnchanged: num(r.skippedUnchanged),
    failed: num(r.failed),
    evidenceCreated: num(r.evidenceCreated),
    evidenceUpdated: num(r.evidenceUpdated),
    rateLimited: r.rateLimited === true,
    rateLimitResetAt: typeof r.rateLimitResetAt === 'string' ? r.rateLimitResetAt : null,
  };
}

export function formatResetTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function rateLimitMessage(stats: SyncStatsView): string | null {
  if (!stats.rateLimited) return null;
  const reset = formatResetTime(stats.rateLimitResetAt);
  return reset
    ? `GitHub's rate limit was reached, so some repositories were not synced. You can sync again after ${reset}. Adding a read-only token raises the limit.`
    : "GitHub's rate limit was reached, so some repositories were not synced. Try again later. Adding a read-only token raises the limit.";
}

export function summarizeSync(stats: SyncStatsView): string {
  return (
    `${stats.reposListed} listed, ${stats.detailSynced} synced in detail, ` +
    `${stats.skippedUnchanged} unchanged, ${stats.failed} failed; ` +
    `${stats.evidenceCreated} evidence created, ${stats.evidenceUpdated} updated.`
  );
}

/** Maps a failed API response to a message; prefers the route's own `error` string. */
export function describeApiError(status: number, body: unknown): string {
  const message =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? ((body as { error: string }).error as string)
      : null;
  if (message) return message;
  if (status === 401) return 'You are signed out. Sign in again.';
  if (status === 409) return 'A sync is already running, or the stored token could not be read.';
  if (status === 429 || status === 503) return 'GitHub is rate limiting requests. Try again later.';
  return 'Something went wrong. Please try again.';
}

/** Client-side mirror of the server's GitHub username rule, for instant feedback only. */
export function isPlausibleLogin(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(value.trim());
}
