import { describe, expect, it } from 'vitest';
import { computeRequirementFingerprint } from './requirement-fingerprint';

describe('computeRequirementFingerprint', () => {
  it('is deterministic for identical text', async () => {
    const first = await computeRequirementFingerprint('5+ years of Python experience');
    const second = await computeRequirementFingerprint('5+ years of Python experience');
    expect(first).toBe(second);
  });

  it('collapses inconsequential whitespace', async () => {
    const first = await computeRequirementFingerprint('5+ years   of Python\nexperience');
    const second = await computeRequirementFingerprint('5+ years of Python experience');
    expect(first).toBe(second);
  });

  it('preserves case', async () => {
    const first = await computeRequirementFingerprint('US work authorization required');
    const second = await computeRequirementFingerprint('us work authorization required');
    expect(first).not.toBe(second);
  });

  it('produces different fingerprints for genuinely different text', async () => {
    const first = await computeRequirementFingerprint('5+ years of Python experience');
    const second = await computeRequirementFingerprint('3+ years of Java experience');
    expect(first).not.toBe(second);
  });
});
