import {
  myosCandidateInputSchema,
  type MyosCandidate,
  type MyosCandidateInput,
} from '@career-os/shared';
import { assertNoError, DatabaseError, unwrapRow } from '../errors';
import type { Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import { createOwnEdge } from './myos-edges';
import { rowToCandidate } from './myos-mappers';

type CandidateStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

const MAX_TALKING_POINTS = 20;

/**
 * Returned (instead of silently marking ACCEPTED) when applying a candidate would not do what
 * the user asked: a PROJECT_SUMMARY when the project already has a summary. The candidate stays
 * PENDING so the user can reject it or clear the summary first.
 */
export interface CandidateConflict {
  status: 'conflict';
  reason: 'SUMMARY_EXISTS';
  message: string;
}
export type AcceptCandidateResult = MyosCandidate | CandidateConflict;

export function isCandidateConflict(result: AcceptCandidateResult): result is CandidateConflict {
  return result.status === 'conflict';
}

export async function listOwnCandidates(
  supabase: CareerOsSupabaseClient,
  userId: string,
  status?: CandidateStatus,
): Promise<MyosCandidate[]> {
  let query = supabase.from('myos_candidates').select('*').eq('user_id', userId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('created_at', { ascending: false });
  assertNoError(error, 'listOwnCandidates');
  return (data ?? []).map(rowToCandidate);
}

export async function getOwnCandidate(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<MyosCandidate | null> {
  const { data, error } = await supabase
    .from('myos_candidates')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnCandidate');
  return data ? rowToCandidate(data) : null;
}

/** Stored payload JSON omits `kind` (it has its own column). */
function toRow(userId: string, input: ReturnType<typeof myosCandidateInputSchema.parse>) {
  const { kind, ...rest } = input.payload;
  return {
    user_id: userId,
    kind,
    project_id: input.projectId,
    payload: rest as unknown as Json,
    evidence_ids: input.evidenceIds,
    rationale: input.rationale ?? null,
    dedupe_key: input.dedupeKey,
  };
}

/**
 * Inserts only candidates whose dedupe_key is new for this user. A key that already exists in
 * ANY status (including REJECTED) is skipped, so a rejected suggestion never resurfaces.
 */
export async function createOwnCandidatesIdempotent(
  supabase: CareerOsSupabaseClient,
  userId: string,
  inputs: MyosCandidateInput[],
): Promise<{ created: number; skipped: number }> {
  const parsed = inputs.map((i) => myosCandidateInputSchema.parse(i));
  const unique = new Map<string, (typeof parsed)[number]>();
  for (const p of parsed) if (!unique.has(p.dedupeKey)) unique.set(p.dedupeKey, p);
  if (unique.size === 0) return { created: 0, skipped: parsed.length };

  const { data: existing, error } = await supabase
    .from('myos_candidates')
    .select('dedupe_key')
    .eq('user_id', userId)
    .in('dedupe_key', [...unique.keys()]);
  assertNoError(error, 'createOwnCandidatesIdempotent.existing');
  const taken = new Set((existing ?? []).map((r) => r.dedupe_key));
  const fresh = [...unique.values()].filter((p) => !taken.has(p.dedupeKey));

  let created = 0;
  if (fresh.length > 0) {
    const { error: insError } = await supabase
      .from('myos_candidates')
      .insert(fresh.map((p) => toRow(userId, p)));
    if (!insError) {
      created = fresh.length;
    } else if ((insError as { code?: string }).code === '23505') {
      // Concurrent writer inserted some of the same keys: fall back to one-at-a-time.
      for (const p of fresh) {
        const { error: oneError } = await supabase.from('myos_candidates').insert(toRow(userId, p));
        if (!oneError) created += 1;
        else if ((oneError as { code?: string }).code !== '23505') {
          assertNoError(oneError, 'createOwnCandidatesIdempotent.insert');
        }
      }
    } else {
      assertNoError(insError, 'createOwnCandidatesIdempotent.insert');
    }
  }
  return { created, skipped: parsed.length - created };
}

async function setStatus(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  status: 'ACCEPTED' | 'REJECTED',
  context: string,
): Promise<MyosCandidate> {
  const { data, error } = await supabase
    .from('myos_candidates')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToCandidate(unwrapRow(data, error, context));
}

export async function rejectOwnCandidate(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<MyosCandidate> {
  return setStatus(supabase, userId, id, 'REJECTED', 'rejectOwnCandidate');
}

async function findOrCreateSkill(
  supabase: CareerOsSupabaseClient,
  userId: string,
  name: string,
  category: string | null,
): Promise<string> {
  const { data, error } = await supabase.from('skills').select('id, name').eq('user_id', userId);
  assertNoError(error, 'acceptOwnCandidate.skills');
  const wanted = name.trim().toLowerCase();
  const match = (data ?? []).find((s) => s.name.trim().toLowerCase() === wanted);
  if (match) return match.id;

  // The user confirming the skill exists is NOT approval to use it in applications:
  // approved_for_applications stays false until they approve it on the Skills page.
  const { data: created, error: insError } = await supabase
    .from('skills')
    .insert({
      user_id: userId,
      name: name.trim(),
      category,
      user_approved: true,
      approved_for_applications: false,
    })
    .select('id')
    .single();
  return unwrapRow(created, insError, 'acceptOwnCandidate.createSkill').id;
}

/**
 * Applies a PENDING candidate to the graph, then marks it ACCEPTED.
 * - SKILL: find-or-create the skill (case-insensitive name), edge project→skill DEMONSTRATES
 *   (USER_PROVIDED — the user just confirmed it), plus evidence→skill SUPPORTS edges (INFERRED,
 *   since the evidence link itself was machine-derived) for evidence rows that still exist.
 * - TALKING_POINT: appended to the project's talking_points (deduped, capped).
 * - PROJECT_SUMMARY: sets the project summary only when it is currently empty; otherwise returns
 *   `{ status: 'conflict' }` and leaves the candidate PENDING.
 * - COMPETENCY: acceptance only (no graph write).
 */
export async function acceptOwnCandidate(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<AcceptCandidateResult> {
  const candidate = await getOwnCandidate(supabase, userId, id);
  if (!candidate) throw new DatabaseError('acceptOwnCandidate: candidate not found');
  if (candidate.status === 'ACCEPTED') return candidate;
  if (candidate.status === 'REJECTED') {
    throw new DatabaseError('acceptOwnCandidate: candidate was already rejected');
  }
  const { payload, projectId } = candidate;

  if (payload.kind === 'SKILL') {
    const skillId = await findOrCreateSkill(supabase, userId, payload.skill, payload.category);
    if (projectId) {
      await createOwnEdge(supabase, userId, {
        fromType: 'PROJECT',
        fromId: projectId,
        toType: 'SKILL',
        toId: skillId,
        relation: 'DEMONSTRATES',
        verificationState: 'USER_PROVIDED',
      });
    }
    if (candidate.evidenceIds.length > 0) {
      const { data: live, error } = await supabase
        .from('myos_evidence')
        .select('id')
        .eq('user_id', userId)
        .in('id', candidate.evidenceIds);
      assertNoError(error, 'acceptOwnCandidate.evidence');
      for (const ev of live ?? []) {
        await createOwnEdge(supabase, userId, {
          fromType: 'EVIDENCE',
          fromId: ev.id,
          toType: 'SKILL',
          toId: skillId,
          relation: 'SUPPORTS',
          verificationState: 'INFERRED',
        });
      }
    }
  } else if (payload.kind === 'TALKING_POINT' || payload.kind === 'PROJECT_SUMMARY') {
    if (!projectId) {
      throw new DatabaseError(`acceptOwnCandidate: ${payload.kind} candidate has no project`);
    }
    const { data: project, error } = await supabase
      .from('projects')
      .select('summary, talking_points')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    assertNoError(error, 'acceptOwnCandidate.project');
    if (!project) throw new DatabaseError('acceptOwnCandidate: project not found');

    if (payload.kind === 'TALKING_POINT') {
      const points = project.talking_points ?? [];
      if (!points.includes(payload.text)) {
        if (points.length >= MAX_TALKING_POINTS) {
          throw new DatabaseError('acceptOwnCandidate: project already has the maximum talking points');
        }
        const { error: upError } = await supabase
          .from('projects')
          .update({ talking_points: [...points, payload.text] })
          .eq('id', projectId)
          .eq('user_id', userId);
        assertNoError(upError, 'acceptOwnCandidate.talkingPoint');
      }
    } else if (project.summary && project.summary.trim() !== '') {
      return {
        status: 'conflict',
        reason: 'SUMMARY_EXISTS',
        message: 'This project already has a summary; the suggestion was not applied.',
      };
    } else {
      const { error: upError } = await supabase
        .from('projects')
        .update({ summary: payload.text })
        .eq('id', projectId)
        .eq('user_id', userId);
      assertNoError(upError, 'acceptOwnCandidate.summary');
    }
  }

  return setStatus(supabase, userId, id, 'ACCEPTED', 'acceptOwnCandidate');
}
