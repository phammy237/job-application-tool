import {
  evaluateConsistencyFindings,
  type ConsistencyAcknowledgement,
  type ConsistencyCandidateAnswer,
  type ConsistencyFinding,
  type GeneratedAnswer,
} from '@career-os/shared';
import type { CareerOsSupabaseClient } from '../types/client';
import { listOwnGeneratedAnswersForApplication } from './generated-answers';
import { listOwnEducation } from './education';
import { listOwnExperiences } from './experiences';
import { getOwnProfile } from './profiles';

/**
 * Thrown by `markOwnApplicationApplied` (Phase 5B.2) when the authoritative, server-recomputed
 * consistency gate refuses a real transition into APPLIED — either a BLOCKING finding exists (in
 * which case `findings` always contains at least one BLOCKING entry, and no acknowledgement can
 * ever satisfy it), or a currently-current WARNING finding was not covered by the caller's
 * `acknowledgedFindingIds`. Callers (API routes, server actions) catch this by type and turn it
 * into `consistencyBlockedResponseSchema`'s shape — never a generic 500.
 */
export class ConsistencyCheckFailedError extends Error {
  constructor(
    public readonly reason: 'blocking_findings' | 'unacknowledged_warnings',
    public readonly findings: ConsistencyFinding[],
  ) {
    super(`Consistency check failed: ${reason}`);
    this.name = 'ConsistencyCheckFailedError';
  }
}

/** Only an answer the user actually decided to use represents "what's about to be submitted" —
 * a SKIPPED suggestion, or one never decided on at all, was never going to be part of the
 * application, so checking it for consistency would be checking content that isn't real. Uses
 * `finalText` when the user edited it, else the original AI answer — never duplicates `answer`
 * into a synthetic "edit". */
function toConsistencyCandidateAnswers(
  generatedAnswers: GeneratedAnswer[],
): ConsistencyCandidateAnswer[] {
  return generatedAnswers
    .filter((a) => a.userDecision === 'APPROVED' || a.userDecision === 'EDITED')
    .map((a) => ({
      generatedAnswerId: a.id,
      fieldLabel: a.fieldLabel,
      fieldClassification: a.fieldClassification,
      text: a.finalText ?? a.answer,
    }));
}

/**
 * Assembles trusted, already-persisted/approved input and runs the deterministic rule engine
 * (`packages/shared`) — the one function both `GET /api/applications/:id/consistency-check`
 * (advisory) and `markOwnApplicationApplied`'s authoritative gate (Phase 5B.2F) call, so they can
 * never drift apart. Only `userApproved && approvedForApplications` education/experience records
 * participate (docs/AI_GROUNDING.md's standing rule, applied here even though this isn't an AI
 * call — an unreviewed record shouldn't be trusted enough to contradict a real application
 * answer). Never trusts client-submitted answer content — every value compared here was already
 * persisted server-side by the suggestion-generation pipeline, not supplied fresh by this call's
 * caller.
 */
export async function evaluateOwnConsistencyFindings(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<ConsistencyFinding[]> {
  const generatedAnswers = await listOwnGeneratedAnswersForApplication(
    supabase,
    userId,
    applicationId,
  );
  return evaluateOwnConsistencyFindingsForAnswers(supabase, userId, generatedAnswers);
}

/** Split out so `markOwnApplicationApplied` (which already fetches this application's
 * generated_answers for the packet's `answers_snapshot`) doesn't have to fetch them twice. */
export async function evaluateOwnConsistencyFindingsForAnswers(
  supabase: CareerOsSupabaseClient,
  userId: string,
  generatedAnswers: GeneratedAnswer[],
): Promise<ConsistencyFinding[]> {
  const [education, experiences, profile] = await Promise.all([
    listOwnEducation(supabase, userId),
    listOwnExperiences(supabase, userId),
    getOwnProfile(supabase, userId),
  ]);

  return evaluateConsistencyFindings({
    answers: toConsistencyCandidateAnswers(generatedAnswers),
    education: education
      .filter((e) => e.userApproved && e.approvedForApplications)
      .map((e) => ({ school: e.school, graduationDate: e.graduationDate, gpa: e.gpa })),
    experiences: experiences
      .filter((e) => e.userApproved && e.approvedForApplications)
      .map((e) => ({
        company: e.company,
        title: e.title,
        startDate: e.startDate,
        endDate: e.endDate,
      })),
    profile: {
      workAuthorization: profile?.workAuthorization ?? null,
      relocationPreference: profile?.relocationPreference ?? null,
    },
  });
}

/**
 * Enforces the authoritative gate (docs/IMPLEMENTATION_PLAN.md Phase 5B.2F): a BLOCKING finding
 * can never be satisfied by anything the caller sends — this function does not even look at
 * `acknowledgedFindingIds` until it has confirmed zero BLOCKING findings exist. A WARNING finding
 * is satisfied only if its exact (freshly recomputed) id appears in `acknowledgedFindingIds` — a
 * stale id from an earlier, now-outdated GET /consistency-check, or an invented one, simply isn't
 * in the current findings list and so can never suppress a real current warning. Returns the
 * acknowledgement records to freeze (only for findings actually satisfied this way — never a
 * record for an id the caller sent that doesn't match anything current) when the gate passes;
 * throws ConsistencyCheckFailedError otherwise.
 */
export function enforceConsistencyGate(
  findings: ConsistencyFinding[],
  acknowledgedFindingIds: string[],
): ConsistencyAcknowledgement[] {
  const blocking = findings.filter((f) => f.severity === 'BLOCKING');
  if (blocking.length > 0) {
    throw new ConsistencyCheckFailedError('blocking_findings', findings);
  }

  const warnings = findings.filter((f) => f.severity === 'WARNING');
  const acknowledgedIds = new Set(acknowledgedFindingIds);
  const unacknowledged = warnings.filter((f) => !acknowledgedIds.has(f.id));
  if (unacknowledged.length > 0) {
    throw new ConsistencyCheckFailedError('unacknowledged_warnings', findings);
  }

  const acknowledgedAt = new Date().toISOString();
  return warnings.map((finding) => ({ findingId: finding.id, acknowledgedAt }));
}
