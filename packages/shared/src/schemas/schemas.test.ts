import { describe, expect, it } from 'vitest';
import {
  aiUsageEventSchema,
  applicationInputSchema,
  applicationStatusSchema,
  candidateFactInputSchema,
  candidateFactSchema,
  detectedFieldSchema,
  experienceSchema,
  extensionSessionSchema,
  generatedAnswerContractSchema,
  generatedAnswerSchema,
  jobExtractionPayloadSchema,
  mintedExtensionTokenSchema,
  profileUpdateSchema,
} from '../index';

describe('candidateFactSchema', () => {
  it('accepts a fully-populated approved fact', () => {
    const result = candidateFactSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      category: 'EXPERIENCE',
      title: 'Backend Engineer @ Acme',
      normalizedValue: 'Built the payments service handling 2M requests/day.',
      sourceText: 'Built payments service...',
      sourceResumeId: null,
      userApproved: true,
      approvedForApplications: true,
      visibleOnPublicProfile: false,
      tags: ['backend', 'payments'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown category', () => {
    const result = candidateFactSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      category: 'NOT_A_REAL_CATEGORY',
      title: 'x',
      normalizedValue: 'x',
      sourceText: null,
      sourceResumeId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('input schema defaults approval flags to false — nothing is approved by default', () => {
    const parsed = candidateFactInputSchema.parse({
      category: 'SKILL',
      title: 'TypeScript',
      normalizedValue: 'TypeScript',
    });
    expect(parsed.userApproved).toBe(false);
    expect(parsed.approvedForApplications).toBe(false);
    expect(parsed.visibleOnPublicProfile).toBe(false);
  });
});

describe('experienceSchema', () => {
  it('defaults tags and displayOrder', () => {
    const parsed = experienceSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      sourceFactId: null,
      company: 'Acme',
      title: 'Engineer',
      location: null,
      employmentType: null,
      startDate: null,
      endDate: null,
      description: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.tags).toEqual([]);
    expect(parsed.displayOrder).toBe(0);
  });
});

describe('applicationStatusSchema', () => {
  it('covers every status from docs/PRODUCT_SPEC.md §7', () => {
    const expected = [
      'SAVED',
      'IN_PROGRESS',
      'APPLIED',
      'APPLICATION_RECEIVED',
      'ASSESSMENT',
      'INTERVIEW',
      'ACTION_REQUIRED',
      'OFFER',
      'REJECTED',
      'WITHDRAWN',
      'UNKNOWN',
    ];
    expect(applicationStatusSchema.options).toEqual(expected);
  });

  it('rejects a status outside the enum', () => {
    expect(applicationStatusSchema.safeParse('GHOSTED').success).toBe(false);
  });
});

describe('applicationInputSchema', () => {
  it('requires company and title', () => {
    const result = applicationInputSchema.safeParse({ company: '', title: '' });
    expect(result.success).toBe(false);
  });

  it('defaults status to SAVED', () => {
    const parsed = applicationInputSchema.parse({ company: 'Acme', title: 'Engineer' });
    expect(parsed.status).toBe('SAVED');
  });
});

describe('profileUpdateSchema', () => {
  it('never includes userId — server always derives it from the session', () => {
    expect('userId' in profileUpdateSchema.shape).toBe(false);
  });
});

describe('extensionSessionSchema', () => {
  it('never includes a token or token_hash field — only mintedExtensionTokenSchema does', () => {
    expect('token' in extensionSessionSchema.shape).toBe(false);
    expect('tokenHash' in extensionSessionSchema.shape).toBe(false);
  });

  it('accepts a valid session', () => {
    const result = extensionSessionSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      deviceLabel: 'Chrome on MacBook',
      lastUsedAt: null,
      expiresAt: '2026-02-01T00:00:00.000Z',
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('mintedExtensionTokenSchema', () => {
  it('requires a token in addition to everything extensionSessionSchema requires', () => {
    const result = mintedExtensionTokenSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      deviceLabel: null,
      lastUsedAt: null,
      expiresAt: '2026-02-01T00:00:00.000Z',
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      token: 'cosext_abcdefghijklmnopqrstuvwxyz',
    });
    expect(result.success).toBe(true);
  });
});

describe('detectedFieldSchema', () => {
  it('accepts every field classification, including ones that must never get a suggestion', () => {
    for (const classification of [
      'BASIC_PROFILE',
      'DEMOGRAPHIC',
      'LEGAL',
      'AUTHENTICATION',
      'UNKNOWN',
    ]) {
      const result = detectedFieldSchema.safeParse({
        fieldId: 'field-1',
        label: 'Some label',
        htmlName: 'some_name',
        htmlId: null,
        inputType: 'text',
        classification,
        confidence: 0.9,
      });
      expect(result.success).toBe(true);
    }
    // Structural validity is not the enforcement point: CLAUDE.md's "never suggested" rule for
    // DEMOGRAPHIC/LEGAL/AUTHENTICATION is enforced in the suggestion/popup code, not here — the
    // extractor's own detection-time exclusion is what should keep AUTHENTICATION fields from
    // ever reaching this schema in practice.
  });

  it('rejects an unknown classification', () => {
    const result = detectedFieldSchema.safeParse({
      fieldId: 'field-1',
      label: null,
      htmlName: null,
      htmlId: null,
      inputType: 'text',
      classification: 'NOT_A_REAL_CLASSIFICATION',
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside [0, 1]', () => {
    const result = detectedFieldSchema.safeParse({
      fieldId: 'field-1',
      label: null,
      htmlName: null,
      htmlId: null,
      inputType: 'text',
      classification: 'UNKNOWN',
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('generatedAnswerContractSchema', () => {
  const valid = {
    answer: 'Built the payments service handling 2M requests/day.',
    confidence: 0.8,
    sourceFactIds: ['11111111-1111-4111-8111-111111111111'],
    reasoningSummary: 'Based on your Acme Corp backend role.',
    unsupportedClaims: [],
    requiresUserReview: true,
    insufficientData: false,
  };

  it('accepts a well-formed contract response', () => {
    expect(generatedAnswerContractSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty sourceFactIds array — there is no zero-provenance answer', () => {
    const result = generatedAnswerContractSchema.safeParse({ ...valid, sourceFactIds: [] });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(generatedAnswerContractSchema.safeParse({ ...valid, confidence: 1.1 }).success).toBe(
      false,
    );
  });

  it('rejects a reasoningSummary over 400 characters', () => {
    const result = generatedAnswerContractSchema.safeParse({
      ...valid,
      reasoningSummary: 'x'.repeat(401),
    });
    expect(result.success).toBe(false);
  });

  it('a non-empty unsupportedClaims still parses structurally — the rejection gate is a separate check, not schema-level', () => {
    const result = generatedAnswerContractSchema.safeParse({
      ...valid,
      unsupportedClaims: ['claims a certification not in any provided fact'],
    });
    expect(result.success).toBe(true);
  });
});

describe('generatedAnswerSchema', () => {
  it('accepts a full persisted row, including a rejected (audit-only) one', () => {
    const result = generatedAnswerSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: null,
      jobId: '33333333-3333-4333-8333-333333333333',
      fieldLabel: 'Why do you want to work here?',
      fieldClassification: 'FREE_RESPONSE',
      answer: 'Draft answer text.',
      confidence: 0.4,
      sourceFactIds: [],
      reasoningSummary: null,
      unsupportedClaims: ['claims a skill not in any provided fact'],
      requiresUserReview: true,
      userDecision: null,
      finalText: null,
      insufficientData: true,
      rejectionReason: 'unsupported_claims_present',
      availableFactIds: ['44444444-4444-4444-8444-444444444444'],
      generationRunId: '55555555-5555-4555-8555-555555555555',
      attemptNumber: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a fieldClassification outside the shared enum', () => {
    const result = generatedAnswerSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: null,
      jobId: null,
      fieldLabel: 'x',
      fieldClassification: 'NOT_A_REAL_CLASSIFICATION',
      answer: 'x',
      confidence: 0.5,
      sourceFactIds: [],
      reasoningSummary: null,
      unsupportedClaims: [],
      requiresUserReview: true,
      userDecision: null,
      finalText: null,
      insufficientData: null,
      rejectionReason: null,
      availableFactIds: null,
      generationRunId: null,
      attemptNumber: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('aiUsageEventSchema', () => {
  it('accepts a real provider attempt row', () => {
    const result = aiUsageEventSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: null,
      generationRunId: '55555555-5555-4555-8555-555555555555',
      attemptNumber: 1,
      ladder: 'normal',
      fieldClassification: 'EXPERIENCE',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      taskType: 'field_suggestion',
      providerSucceeded: true,
      outcome: 'accepted',
      rejectionReason: null,
      escalationReason: null,
      inputTokens: 1200,
      cachedInputTokens: 0,
      outputTokens: 150,
      estimatedCost: 0.00042,
      latencyMs: 850,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a deterministic short-circuit row with a null provider/model', () => {
    const result = aiUsageEventSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: null,
      generationRunId: '55555555-5555-4555-8555-555555555555',
      attemptNumber: 1,
      ladder: 'deterministic',
      fieldClassification: 'BASIC_PROFILE',
      provider: null,
      model: null,
      taskType: 'field_suggestion',
      providerSucceeded: null,
      outcome: 'deterministic',
      rejectionReason: null,
      escalationReason: null,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      latencyMs: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an outcome outside the enum', () => {
    const result = aiUsageEventSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      applicationId: null,
      generationRunId: '55555555-5555-4555-8555-555555555555',
      attemptNumber: 1,
      ladder: 'normal',
      fieldClassification: 'EXPERIENCE',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      taskType: 'field_suggestion',
      providerSucceeded: true,
      outcome: 'NOT_A_REAL_OUTCOME',
      rejectionReason: null,
      escalationReason: null,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCost: null,
      latencyMs: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('jobExtractionPayloadSchema', () => {
  it('is the same shape as jobInputSchema (company/title required to be present as keys, no id/userId/timestamps)', () => {
    expect('id' in jobExtractionPayloadSchema.shape).toBe(false);
    expect('userId' in jobExtractionPayloadSchema.shape).toBe(false);
    expect('createdAt' in jobExtractionPayloadSchema.shape).toBe(false);
    expect('company' in jobExtractionPayloadSchema.shape).toBe(true);
  });
});
