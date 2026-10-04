import {
  createOwnCandidatesIdempotent,
  listOwnEvidence,
  listOwnGithubRepositories,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { extractCandidatesFromRepository } from '@career-os/shared';

export interface CandidateGenerationResult {
  repositories: number;
  created: number;
  skipped: number;
}

/**
 * After a GitHub sync, derive deterministic PENDING candidates for every repository the user
 * selected AND mapped to a project. Extraction is template-based (no LLM, no AI quota). It is
 * idempotent: `createOwnCandidatesIdempotent` skips any dedupe key that already exists for this
 * user in ANY status, so accepted and rejected suggestions are never re-suggested.
 *
 * `userId` must come from the verified session; every query is filtered by it explicitly.
 */
export async function generateCandidatesForSelectedRepos(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<CandidateGenerationResult> {
  const [repos, evidence] = await Promise.all([
    listOwnGithubRepositories(supabase, userId),
    listOwnEvidence(supabase, userId),
  ]);

  // GITHUB_REPO / GITHUB_README evidence is keyed by the repo full name (see the sync engine).
  const evidenceIdsByRepo = new Map<string, string[]>();
  for (const e of evidence) {
    if (e.sourceType !== 'GITHUB_REPO' && e.sourceType !== 'GITHUB_README') continue;
    if (!e.sourceRef) continue;
    const list = evidenceIdsByRepo.get(e.sourceRef) ?? [];
    list.push(e.id);
    evidenceIdsByRepo.set(e.sourceRef, list);
  }

  const result: CandidateGenerationResult = { repositories: 0, created: 0, skipped: 0 };
  for (const repo of repos) {
    if (!repo.selected || !repo.projectId) continue;
    const evidenceIds = evidenceIdsByRepo.get(repo.fullName) ?? [];
    const candidates = extractCandidatesFromRepository(repo, evidenceIds, repo.projectId);
    if (candidates.length === 0) continue;
    const r = await createOwnCandidatesIdempotent(supabase, userId, candidates);
    result.repositories += 1;
    result.created += r.created;
    result.skipped += r.skipped;
  }
  return result;
}
