import type { SubmissionPacketAnswer } from '../schemas/submission-packet';
import type { AutofillSummary, UnresolvedFieldSummary } from '../schemas/application';
import type {
  ConsistencyAcknowledgement,
  ConsistencyFinding,
} from '../schemas/consistency-finding';

/**
 * Everything that participates in a submission packet's content fingerprint — deliberately
 * excludes `id`/`createdAt` (identity/system metadata, not content) so the fingerprint answers
 * "does this packet's actual content match," not "is this literally the same row." Mirrors
 * `computeJobSnapshotFingerprint`'s design exactly (docs/IMPLEMENTATION_PLAN.md Phase 5B.1J):
 * fixed key order, deterministic array/object serialization, SHA-256 of the UTF-8 bytes of that
 * canonical JSON, hex-encoded, prefixed `"v1:"` so a future normalization change (bumped to
 * `"v2:"`) can never collide with an old packet's fingerprint.
 */
export interface SubmissionPacketFingerprintInput {
  applicationId: string;
  jobSnapshotId: string | null;
  resumeId: string | null;
  /** Added in migration 0021 (Phase 7B) — participates in the fingerprint for the same reason
   * every other frozen field does: two packets whose only difference is which résumé version was
   * submitted must not fingerprint identically. */
  resumeVersionId: string | null;
  requirementMappingRunId: string | null;
  answersSnapshot: SubmissionPacketAnswer[];
  autofillSummary: AutofillSummary | null;
  unresolvedFields: UnresolvedFieldSummary[] | null;
  consistencyFindings: ConsistencyFinding[];
  consistencyAcknowledgements: ConsistencyAcknowledgement[];
}

/** Key order fixed explicitly per answer entry — object key order in `JSON.stringify` follows
 * insertion order, which is otherwise whatever order the caller happened to build the object in;
 * pinning it here is what makes two logically-identical packets fingerprint identically
 * regardless of how their source objects were constructed. */
function canonicalizeAnswer(answer: SubmissionPacketAnswer) {
  return {
    generatedAnswerId: answer.generatedAnswerId,
    fieldLabel: answer.fieldLabel,
    fieldClassification: answer.fieldClassification,
    originalAnswer: answer.originalAnswer,
    finalText: answer.finalText,
    userDecision: answer.userDecision,
    sourceFactIds: [...answer.sourceFactIds].sort(),
    confidence: answer.confidence,
  };
}

function canonicalizeFinding(finding: ConsistencyFinding) {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    severity: finding.severity,
    fieldALabel: finding.fieldALabel,
    fieldASource: finding.fieldASource,
    fieldAValue: finding.fieldAValue,
    fieldBLabel: finding.fieldBLabel,
    fieldBSource: finding.fieldBSource,
    fieldBValue: finding.fieldBValue,
    description: finding.description,
  };
}

function canonicalizeAcknowledgement(ack: ConsistencyAcknowledgement) {
  return { findingId: ack.findingId, acknowledgedAt: ack.acknowledgedAt };
}

export async function computeSubmissionPacketFingerprint(
  input: SubmissionPacketFingerprintInput,
): Promise<string> {
  const canonical = {
    applicationId: input.applicationId,
    jobSnapshotId: input.jobSnapshotId,
    resumeId: input.resumeId,
    resumeVersionId: input.resumeVersionId,
    requirementMappingRunId: input.requirementMappingRunId,
    // Answer order is preserved, not sorted — it reflects generation order, itself meaningful
    // provenance, same posture as job_snapshots' qualification arrays.
    answersSnapshot: input.answersSnapshot.map(canonicalizeAnswer),
    autofillSummary: input.autofillSummary,
    unresolvedFields: input.unresolvedFields,
    consistencyFindings: input.consistencyFindings.map(canonicalizeFinding),
    consistencyAcknowledgements: input.consistencyAcknowledgements.map(
      canonicalizeAcknowledgement,
    ),
  };

  return `v1:${await sha256Hex(JSON.stringify(canonical))}`;
}

/** Web Crypto, not `node:crypto` — this package is bundled into the extension (Vite) as well as
 * the server (Node); see job-snapshot-fingerprint.ts's identical doc comment. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
