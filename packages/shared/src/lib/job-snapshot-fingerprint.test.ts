import { describe, expect, it } from 'vitest';
import {
  computeJobSnapshotFingerprint,
  JOB_SNAPSHOT_CAPS,
  sanitizeJobSnapshotInput,
  type JobSnapshotSanitizableInput,
} from './job-snapshot-fingerprint';

const BASE_INPUT: JobSnapshotSanitizableInput = {
  company: 'Acme Corp',
  title: 'Backend Engineer',
  location: 'Remote',
  employmentType: 'Full-time',
  sourceUrl: 'https://boards.example.com/job/123',
  externalId: 'REQ-1',
  description: 'Build things.',
  requiredQualifications: ['5 years of Python', 'BS in CS'],
  preferredQualifications: ['AWS experience'],
  responsibilities: ['Ship features'],
  skills: ['Python', 'PostgreSQL'],
  salaryMin: 100_000,
  salaryMax: 150_000,
  salaryCurrency: 'USD',
  locations: ['Remote'],
  workMode: 'REMOTE',
  remoteLocationRestrictions: null,
  workAuthorizationLanguage: null,
  sourceType: 'GENERIC',
};

async function fingerprintOf(input: JobSnapshotSanitizableInput): Promise<string> {
  const { sanitized, contentTruncated, truncatedFields } = sanitizeJobSnapshotInput(input);
  return computeJobSnapshotFingerprint(sanitized, { contentTruncated, truncatedFields });
}

describe('computeJobSnapshotFingerprint', () => {
  it('is deterministic for identical sanitized content', async () => {
    const first = await fingerprintOf(BASE_INPUT);
    const second = await fingerprintOf({ ...BASE_INPUT });
    expect(first).toBe(second);
  });

  it('is prefixed with the format version', async () => {
    const fingerprint = await fingerprintOf(BASE_INPUT);
    expect(fingerprint.startsWith('v1:')).toBe(true);
  });

  it('preserves case — "US" and "us" are not conflated', async () => {
    const upper = await fingerprintOf({ ...BASE_INPUT, description: 'Work authorization: US only.' });
    const lower = await fingerprintOf({ ...BASE_INPUT, description: 'Work authorization: us only.' });
    expect(upper).not.toBe(lower);
  });

  it('collapses inconsequential whitespace only', async () => {
    const withExtraSpace = await fingerprintOf({ ...BASE_INPUT, description: 'Build   things.\n\n' });
    const collapsed = await fingerprintOf({ ...BASE_INPUT, description: 'Build things.' });
    expect(withExtraSpace).toBe(collapsed);
  });

  it('treats null and empty string as distinct', async () => {
    const withNull = await fingerprintOf({ ...BASE_INPUT, employmentType: null });
    const withEmpty = await fingerprintOf({ ...BASE_INPUT, employmentType: '' });
    expect(withNull).not.toBe(withEmpty);
  });

  it('is sensitive to array order (not sorted away)', async () => {
    const original = await fingerprintOf(BASE_INPUT);
    const reordered = await fingerprintOf({
      ...BASE_INPUT,
      requiredQualifications: [...BASE_INPUT.requiredQualifications].reverse(),
    });
    expect(original).not.toBe(reordered);
  });

  it('changes when sourceUrl alone changes', async () => {
    const original = await fingerprintOf(BASE_INPUT);
    const changed = await fingerprintOf({ ...BASE_INPUT, sourceUrl: 'https://boards.example.com/job/456' });
    expect(original).not.toBe(changed);
  });

  it('changes when externalId alone changes', async () => {
    const original = await fingerprintOf(BASE_INPUT);
    const changed = await fingerprintOf({ ...BASE_INPUT, externalId: 'REQ-2' });
    expect(original).not.toBe(changed);
  });

  it('changes when a currently-deferred field (salary) alone changes', async () => {
    const original = await fingerprintOf(BASE_INPUT);
    const changed = await fingerprintOf({ ...BASE_INPUT, salaryMin: 90_000 });
    expect(original).not.toBe(changed);
  });

  it('unchanged content produces the same fingerprint even after re-sanitization', async () => {
    const first = await fingerprintOf(BASE_INPUT);
    const { sanitized, contentTruncated, truncatedFields } = sanitizeJobSnapshotInput(BASE_INPUT);
    const second = await computeJobSnapshotFingerprint(sanitized, { contentTruncated, truncatedFields });
    expect(first).toBe(second);
  });
});

describe('sanitizeJobSnapshotInput', () => {
  it('truncates an oversized field and records it in truncatedFields', () => {
    const longDescription = 'x'.repeat(JOB_SNAPSHOT_CAPS.description + 500);
    const result = sanitizeJobSnapshotInput({ ...BASE_INPUT, description: longDescription });
    expect(result.contentTruncated).toBe(true);
    expect(result.truncatedFields).toContain('description');
    expect(result.sanitized.description).toHaveLength(JOB_SNAPSHOT_CAPS.description);
  });

  it('truncates an oversized array to the max element count', () => {
    const manySkills = Array.from({ length: JOB_SNAPSHOT_CAPS.qualificationArrayLength + 10 }, (_, i) => `skill-${i}`);
    const result = sanitizeJobSnapshotInput({ ...BASE_INPUT, skills: manySkills });
    expect(result.contentTruncated).toBe(true);
    expect(result.truncatedFields).toContain('skills');
    expect(result.sanitized.skills).toHaveLength(JOB_SNAPSHOT_CAPS.qualificationArrayLength);
  });

  it('does not flag truncation for content within caps', () => {
    const result = sanitizeJobSnapshotInput(BASE_INPUT);
    expect(result.contentTruncated).toBe(false);
    expect(result.truncatedFields).toEqual([]);
  });

  it('a truncated save produces a different fingerprint than an equivalent non-truncated save', async () => {
    const longDescription = 'x'.repeat(JOB_SNAPSHOT_CAPS.description + 500);
    const truncatedResult = sanitizeJobSnapshotInput({ ...BASE_INPUT, description: longDescription });
    const withinCapResult = sanitizeJobSnapshotInput({
      ...BASE_INPUT,
      description: 'x'.repeat(JOB_SNAPSHOT_CAPS.description),
    });
    const truncatedFingerprint = await computeJobSnapshotFingerprint(truncatedResult.sanitized, {
      contentTruncated: truncatedResult.contentTruncated,
      truncatedFields: truncatedResult.truncatedFields,
    });
    const withinCapFingerprint = await computeJobSnapshotFingerprint(withinCapResult.sanitized, {
      contentTruncated: withinCapResult.contentTruncated,
      truncatedFields: withinCapResult.truncatedFields,
    });
    // Same stored text (both capped at the limit) but different truncation metadata must still
    // change the fingerprint — content_truncated/truncated_fields are part of stored content.
    expect(truncatedFingerprint).not.toBe(withinCapFingerprint);
  });
});
