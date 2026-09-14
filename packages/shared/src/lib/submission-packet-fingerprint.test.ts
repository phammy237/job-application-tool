import { describe, expect, it } from 'vitest';
import {
  computeSubmissionPacketFingerprint,
  type SubmissionPacketFingerprintInput,
} from './submission-packet-fingerprint';

function baseInput(): SubmissionPacketFingerprintInput {
  return {
    applicationId: '11111111-1111-4111-8111-111111111111',
    jobSnapshotId: '22222222-2222-4222-8222-222222222222',
    resumeId: null,
    resumeVersionId: null,
    requirementMappingRunId: null,
    answersSnapshot: [
      {
        generatedAnswerId: '33333333-3333-4333-8333-333333333333',
        fieldLabel: 'Why us?',
        fieldClassification: 'FREE_RESPONSE',
        originalAnswer: 'Because...',
        finalText: null,
        userDecision: 'APPROVED',
        sourceFactIds: ['44444444-4444-4444-8444-444444444444'],
        confidence: 0.9,
      },
    ],
    autofillSummary: {
      approved: 1,
      filled: 1,
      skipped: 0,
      failed: 0,
      unresolved: 0,
      manual: 0,
    },
    unresolvedFields: [],
    consistencyFindings: [],
    consistencyAcknowledgements: [],
  };
}

describe('computeSubmissionPacketFingerprint', () => {
  it('is deterministic for identical logical content', async () => {
    const a = await computeSubmissionPacketFingerprint(baseInput());
    const b = await computeSubmissionPacketFingerprint(baseInput());
    expect(a).toBe(b);
  });

  it('is prefixed with the version tag', async () => {
    const fingerprint = await computeSubmissionPacketFingerprint(baseInput());
    expect(fingerprint.startsWith('v1:')).toBe(true);
  });

  it('does not change when sourceFactIds are supplied in a different order (canonical, sorted)', async () => {
    const input1 = baseInput();
    input1.answersSnapshot[0]!.sourceFactIds = ['a', 'b'];
    const input2 = baseInput();
    input2.answersSnapshot[0]!.sourceFactIds = ['b', 'a'];
    expect(await computeSubmissionPacketFingerprint(input1)).toBe(
      await computeSubmissionPacketFingerprint(input2),
    );
  });

  it('changes when the answer content changes', async () => {
    const original = await computeSubmissionPacketFingerprint(baseInput());
    const changed = baseInput();
    changed.answersSnapshot[0]!.finalText = 'A different final answer.';
    expect(await computeSubmissionPacketFingerprint(changed)).not.toBe(original);
  });

  it('changes when a consistency finding is added', async () => {
    const original = await computeSubmissionPacketFingerprint(baseInput());
    const changed = baseInput();
    changed.consistencyFindings = [
      {
        id: 'abc',
        ruleId: 'GPA_MISMATCH',
        severity: 'WARNING',
        fieldALabel: 'GPA',
        fieldASource: 'GENERATED_ANSWER',
        fieldAValue: '3.2',
        fieldBLabel: 'GPA',
        fieldBSource: 'PROFILE_EDUCATION',
        fieldBValue: '3.9',
        description: 'Mismatch',
      },
    ];
    expect(await computeSubmissionPacketFingerprint(changed)).not.toBe(original);
  });

  it('changes when the application/snapshot reference changes', async () => {
    const original = await computeSubmissionPacketFingerprint(baseInput());
    const changed = baseInput();
    changed.jobSnapshotId = '99999999-9999-4999-8999-999999999999';
    expect(await computeSubmissionPacketFingerprint(changed)).not.toBe(original);
  });

  it('changes when the submitted résumé version changes', async () => {
    const original = await computeSubmissionPacketFingerprint(baseInput());
    const changed = baseInput();
    changed.resumeVersionId = '55555555-5555-4555-8555-555555555555';
    expect(await computeSubmissionPacketFingerprint(changed)).not.toBe(original);
  });
});
