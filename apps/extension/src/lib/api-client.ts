import {
  consistencyBlockedResponseSchema,
  consistencyCheckResponseSchema,
  generateSuggestionResponseSchema,
  saveApplicationResponseSchema,
  trackedApplicationResponseSchema,
  type AutofillSummary,
  type ConsistencyBlockedResponse,
  type ConsistencyCheckResponse,
  type FieldClassification,
  type GenerateSuggestionResponse,
  type JobExtractionPayload,
  type SaveApplicationRequest,
  type SaveApplicationResponse,
  type TrackedApplicationResponse,
  type UnresolvedFieldSummary,
} from '@career-os/shared';
import { getStoredAuth } from './storage';

type AnsweredField = SaveApplicationRequest['answeredFields'][number];

/**
 * Same-origin as the Career OS web app in production (apply.mypham.space); overridable for
 * local dev against a Next.js dev/prod server on a different port. The extension never talks
 * to any other backend — no Supabase/Claude/Gmail credentials live here (see .eslintrc.json's
 * no-restricted-imports rule banning @career-os/database/ai/email from this package).
 */
export const API_BASE_URL =
  import.meta.env.VITE_CAREER_OS_API_URL ?? 'https://apply.mypham.space';

class NotConnectedError extends Error {
  constructor() {
    super('Not connected — open the Career OS extension-connect page and try again.');
    this.name = 'NotConnectedError';
  }
}

async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
  const auth = await getStoredAuth();
  if (!auth) throw new NotConnectedError();

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Persists the extraction (docs/EXTENSION_DESIGN.md §3 runtime flow) — no AI ranking, no field
 * persistence, matching Phase 2's boundary exactly (the backend route enforces this too; see
 * apps/web/app/api/jobs/analyze/route.ts).
 *
 * Distinguishes three failure shapes the popup previously collapsed into one generic message —
 * useful for telling "the token is stale/wrong-environment" apart from "the API is unreachable"
 * apart from "the request reached the server and it rejected it" without exposing the token
 * itself in any of them:
 *   - the fetch call itself throwing (network unreachable, DNS failure, CORS rejection — most
 *     commonly a dev/prod environment mismatch, e.g. a production-mode build talking to
 *     apply.mypham.space while the token was minted by a local dev server)
 *   - a 401 (the bearer token was rejected server-side — expired, revoked, or minted by a
 *     different environment's database than the one this build's API_BASE_URL points at)
 *   - any other non-2xx status (the request reached the server and its own logic rejected it)
 */
export async function analyzeJob(
  job: JobExtractionPayload,
): Promise<{ jobId: string; created: boolean }> {
  let res: Response;
  try {
    res = await authorizedFetch('/api/jobs/analyze', {
      method: 'POST',
      body: JSON.stringify(job),
    });
  } catch (error) {
    if (error instanceof NotConnectedError) throw error;
    throw new Error(
      `Could not reach the Career OS API at ${API_BASE_URL} — check your network connection ` +
        `and that the server is running there.`,
      { cause: error },
    );
  }

  if (res.status === 401) {
    throw new Error(
      'Authentication was rejected (401) — reconnect the extension from Career OS Settings. ' +
        'This also happens when the extension build points at a different environment than the ' +
        'one that issued its stored token.',
    );
  }
  if (!res.ok) {
    throw new Error(`Failed to save the analyzed job (status ${res.status}).`);
  }
  return res.json();
}

/** Non-2xx outcomes the suggestions endpoint returns via HTTP status rather than in the
 * `status`-discriminated 200 body — see generateSuggestionResponseSchema's doc comment. */
export type SuggestionOutcome =
  | GenerateSuggestionResponse
  | { status: 'rate_limited' }
  | { status: 'job_not_found' }
  | { status: 'provider_error'; message: string };

/**
 * Requests a suggestion for one detected field (docs/IMPLEMENTATION_PLAN.md Phase 4A). One
 * field per call, matching POST /api/jobs/:id/suggestions' shape — the popup's review hook is
 * responsible for calling this per-field and sequencing calls (never firing every eligible
 * field's request in parallel), since each call spends one of the user's rate-limited AI
 * requests.
 */
export async function requestSuggestion(
  jobId: string,
  fieldLabel: string,
  fieldClassification: FieldClassification,
): Promise<SuggestionOutcome> {
  const res = await authorizedFetch(`/api/jobs/${jobId}/suggestions`, {
    method: 'POST',
    body: JSON.stringify({ fieldLabel, fieldClassification }),
  });

  if (res.status === 404) return { status: 'job_not_found' };
  if (res.status === 429) return { status: 'rate_limited' };

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Request failed (status ${res.status}).`;
    return { status: 'provider_error', message };
  }

  const parsed = generateSuggestionResponseSchema.safeParse(
    await res.json().catch(() => null),
  );
  if (!parsed.success) {
    return {
      status: 'provider_error',
      message: 'Unexpected response shape from the suggestions API.',
    };
  }
  return parsed.data;
}

/**
 * "Is this job already tracked?" — GET /api/applications?jobId=... (docs/IMPLEMENTATION_PLAN.md
 * Phase 4C). Returns null on any error rather than throwing — this backs a proactive UI hint,
 * not a blocking check, so a transient failure here shouldn't prevent the rest of the popup
 * from working.
 */
export async function getTrackedApplication(
  jobId: string,
): Promise<TrackedApplicationResponse['application']> {
  try {
    const res = await authorizedFetch(
      `/api/applications?jobId=${encodeURIComponent(jobId)}`,
      {
        method: 'GET',
      },
    );
    if (!res.ok) return null;
    const parsed = trackedApplicationResponseSchema.safeParse(
      await res.json().catch(() => null),
    );
    return parsed.success ? parsed.data.application : null;
  } catch {
    return null;
  }
}

export type SaveApplicationOutcome =
  | { status: 'ok'; result: SaveApplicationResponse }
  | { status: 'job_not_found' }
  | { status: 'error'; message: string };

/**
 * Creates or updates the tracked application for a job (docs/IMPLEMENTATION_PLAN.md Phase 4C).
 * Only ever sends SAVED/IN_PROGRESS — never a client-chosen APPLIED, which has its own separate
 * endpoint (markApplied below) requiring its own explicit user action.
 */
export async function saveApplication(input: {
  jobId: string;
  status: 'SAVED' | 'IN_PROGRESS';
  autofillSummary: AutofillSummary;
  unresolvedFields: UnresolvedFieldSummary[];
  answeredFields: AnsweredField[];
}): Promise<SaveApplicationOutcome> {
  const res = await authorizedFetch('/api/applications', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (res.status === 404) return { status: 'job_not_found' };

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Request failed (status ${res.status}).`;
    return { status: 'error', message };
  }

  const parsed = saveApplicationResponseSchema.safeParse(
    await res.json().catch(() => null),
  );
  if (!parsed.success) {
    return { status: 'error', message: 'Unexpected response shape from the save API.' };
  }
  return { status: 'ok', result: parsed.data };
}

/**
 * Advisory-only (docs/IMPLEMENTATION_PLAN.md Phase 5B.2I) — read fresh right before showing the
 * mark-applied confirm step, never cached, never trusted as authoritative; the PATCH mark-applied
 * call below re-verifies everything server-side regardless of what this returned. Returns an
 * empty findings list on any error so a transient failure here degrades to "proceed with the
 * ordinary confirm," never blocks the user from even trying.
 */
export async function checkConsistency(
  applicationId: string,
): Promise<ConsistencyCheckResponse> {
  try {
    const res = await authorizedFetch(
      `/api/applications/${applicationId}/consistency-check`,
      {
        method: 'GET',
      },
    );
    if (!res.ok) return { findings: [], blockingCount: 0, warningCount: 0 };
    const parsed = consistencyCheckResponseSchema.safeParse(
      await res.json().catch(() => null),
    );
    return parsed.success
      ? parsed.data
      : { findings: [], blockingCount: 0, warningCount: 0 };
  } catch {
    return { findings: [], blockingCount: 0, warningCount: 0 };
  }
}

export type MarkAppliedOutcome =
  | { status: 'ok'; appliedAt: string }
  | { status: 'consistency_check_failed'; result: ConsistencyBlockedResponse }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/**
 * The extension's only path to APPLIED — a separate, explicit action from saving (see
 * apps/web/app/api/applications/[id]/mark-applied/route.ts). `acknowledgedFindingIds` carries
 * only the ids of WARNING findings the popup already showed the user and had them explicitly
 * check — this route never trusts findings/severity/values from the client; the server
 * recomputes the whole gate itself (docs/IMPLEMENTATION_PLAN.md Phase 5B.2F).
 */
export async function markApplied(
  applicationId: string,
  acknowledgedFindingIds: string[] = [],
): Promise<MarkAppliedOutcome> {
  const res = await authorizedFetch(`/api/applications/${applicationId}/mark-applied`, {
    method: 'PATCH',
    body: JSON.stringify({ acknowledgedFindingIds }),
  });

  if (res.status === 404) return { status: 'not_found' };
  if (res.status === 409) {
    const parsed = consistencyBlockedResponseSchema.safeParse(
      await res.json().catch(() => null),
    );
    if (parsed.success)
      return { status: 'consistency_check_failed', result: parsed.data };
    return {
      status: 'error',
      message: 'Unexpected response shape from the mark-applied API.',
    };
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Request failed (status ${res.status}).`;
    return { status: 'error', message };
  }

  const body = (await res.json().catch(() => null)) as { appliedAt?: unknown } | null;
  if (!body || typeof body.appliedAt !== 'string') {
    return {
      status: 'error',
      message: 'Unexpected response shape from the mark-applied API.',
    };
  }
  return { status: 'ok', appliedAt: body.appliedAt };
}
