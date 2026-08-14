import type { ApprovedFactForGeneration } from '@career-os/database';
import type { JobSnapshot } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import { buildRequirementMappingUserPrompt } from './build-requirement-mapping-user-prompt';

const SNAPSHOT: JobSnapshot = {
  id: 'snap-1',
  userId: 'user-1',
  sourceJobId: 'job-1',
  company: 'Acme',
  title: 'Backend Engineer',
  location: 'Remote',
  employmentType: 'Full-time',
  sourceUrl: null,
  externalId: null,
  description: 'Build the payments service.',
  requiredQualifications: ['5+ years backend experience'],
  preferredQualifications: ['AWS experience'],
  responsibilities: ['Own the payments pipeline'],
  skills: ['TypeScript', 'Postgres'],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  locations: ['Remote'],
  workMode: 'REMOTE',
  remoteLocationRestrictions: null,
  workAuthorizationLanguage: null,
  sourceType: 'GENERIC',
  contentFingerprint: 'v1:abc',
  contentTruncated: false,
  truncatedFields: [],
  capturedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const FACT: ApprovedFactForGeneration = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceTable: 'experiences',
  category: 'EXPERIENCE',
  text: 'Built the payments service using TypeScript and Postgres.',
  tags: [],
  recencyDate: '2025-01-01',
  isOngoing: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('buildRequirementMappingUserPrompt — job content as untrusted data', () => {
  it('never places snapshot content in the static system prompt, only inside <job_snapshot>', () => {
    const nonce = 'NONCE-IGNORE-ALL-PRIOR-INSTRUCTIONS-8f3a2b';
    const { userText } = buildRequirementMappingUserPrompt({
      snapshot: { ...SNAPSHOT, description: nonce },
      facts: [FACT],
    });
    expect(userText).toContain('<job_snapshot>');
    expect(userText.indexOf(nonce)).toBeGreaterThan(userText.indexOf('<job_snapshot>'));
    expect(userText.indexOf(nonce)).toBeLessThan(userText.indexOf('</job_snapshot>'));
  });

  it('returns allowedFactIds as exactly the ids placed in <candidate_facts>', () => {
    const { allowedFactIds } = buildRequirementMappingUserPrompt({ snapshot: SNAPSHOT, facts: [FACT] });
    expect(allowedFactIds).toEqual(new Set([FACT.id]));
  });

  it('includes the full sanitized snapshot representation, not just description', () => {
    const { userText } = buildRequirementMappingUserPrompt({ snapshot: SNAPSHOT, facts: [FACT] });
    expect(userText).toContain('5+ years backend experience');
    expect(userText).toContain('AWS experience');
    expect(userText).toContain('Own the payments pipeline');
    expect(userText).toContain('TypeScript, Postgres');
  });

  it('appends the retry reason only when provided', () => {
    const withoutRetry = buildRequirementMappingUserPrompt({ snapshot: SNAPSHOT, facts: [FACT] });
    expect(withoutRetry.userText).not.toContain('Your previous attempt was rejected');

    const withRetry = buildRequirementMappingUserPrompt({
      snapshot: SNAPSHOT,
      facts: [FACT],
      retryReason: 'the response was not valid JSON',
    });
    expect(withRetry.userText).toContain('Your previous attempt was rejected');
  });

  it('omits optional sections entirely when their fields are empty/null (never extracted)', () => {
    const minimal: JobSnapshot = {
      ...SNAPSHOT,
      locations: [],
      workMode: null,
      remoteLocationRestrictions: null,
      workAuthorizationLanguage: null,
      preferredQualifications: [],
      responsibilities: [],
    };
    const { userText } = buildRequirementMappingUserPrompt({ snapshot: minimal, facts: [FACT] });
    expect(userText).not.toContain('Work mode:');
    expect(userText).not.toContain('Remote location restrictions:');
    expect(userText).not.toContain('Preferred qualifications:');
  });
});
