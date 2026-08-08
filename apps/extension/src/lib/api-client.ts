import type { JobExtractionPayload } from '@career-os/shared';
import { getStoredAuth } from './storage';

/**
 * Same-origin as the Career OS web app in production (apply.mypham.space); overridable for
 * local dev against a Next.js dev/prod server on a different port. The extension never talks
 * to any other backend — no Supabase/Claude/Gmail credentials live here (see .eslintrc.json's
 * no-restricted-imports rule banning @career-os/database/ai/email from this package).
 */
const API_BASE_URL = import.meta.env.VITE_CAREER_OS_API_URL ?? 'https://apply.mypham.space';

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
 */
export async function analyzeJob(
  job: JobExtractionPayload,
): Promise<{ jobId: string; created: boolean }> {
  const res = await authorizedFetch('/api/jobs/analyze', {
    method: 'POST',
    body: JSON.stringify(job),
  });
  if (!res.ok) {
    throw new Error(`Failed to save the analyzed job (status ${res.status}).`);
  }
  return res.json();
}
