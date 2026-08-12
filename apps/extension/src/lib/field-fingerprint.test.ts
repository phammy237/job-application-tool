import type { DetectedField } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import { fingerprintField, fingerprintMatches } from './field-fingerprint';

function field(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    fieldId: 'field-0',
    label: 'Full Name',
    htmlName: 'full_name',
    htmlId: 'full_name',
    inputType: 'text',
    classification: 'BASIC_PROFILE',
    confidence: 0.8,
    currentValue: null,
    ...overrides,
  };
}

describe('fingerprintField', () => {
  it('never includes the raw currentValue text', () => {
    const fingerprint = fingerprintField(field({ currentValue: 'Jane Doe' }));
    expect(JSON.stringify(fingerprint)).not.toContain('Jane Doe');
  });

  it('hashes a non-empty currentValue for a non-sensitive field', () => {
    const fingerprint = fingerprintField(field({ currentValue: 'Jane Doe' }));
    expect(fingerprint.currentValueHash).not.toBeNull();
  });

  it('leaves currentValueHash null when currentValue is null', () => {
    const fingerprint = fingerprintField(field({ currentValue: null }));
    expect(fingerprint.currentValueHash).toBeNull();
  });

  it('leaves currentValueHash null for DEMOGRAPHIC/LEGAL/AUTHENTICATION fields even when filled — the raw or hashed value never leaves the page for these', () => {
    for (const classification of ['DEMOGRAPHIC', 'LEGAL', 'AUTHENTICATION'] as const) {
      const fingerprint = fingerprintField(
        field({ classification, currentValue: 'sensitive answer' }),
      );
      expect(fingerprint.currentValueHash).toBeNull();
    }
  });
});

describe('fingerprintMatches', () => {
  it('matches an identical field', () => {
    const original = field({ currentValue: 'Jane Doe' });
    expect(fingerprintMatches(fingerprintField(original), original)).toBe(true);
  });

  it('does not match when the label changes', () => {
    const original = field();
    const changed = field({ label: 'Something else' });
    expect(fingerprintMatches(fingerprintField(original), changed)).toBe(false);
  });

  it('does not match when the classification changes', () => {
    const original = field({ classification: 'BASIC_PROFILE' });
    const changed = field({ classification: 'EXPERIENCE' });
    expect(fingerprintMatches(fingerprintField(original), changed)).toBe(false);
  });

  it('does not match when currentValue changes from empty to filled', () => {
    const original = field({ currentValue: null });
    const changed = field({ currentValue: 'now filled in' });
    expect(fingerprintMatches(fingerprintField(original), changed)).toBe(false);
  });

  it('does not match when currentValue text changes (both non-empty)', () => {
    const original = field({ currentValue: 'John' });
    const changed = field({ currentValue: 'Jonathan' });
    expect(fingerprintMatches(fingerprintField(original), changed)).toBe(false);
  });

  it('two different-content fields with the same index-based fieldId do not spuriously match — the real regression this guards against', () => {
    const oldFieldOnOldPage = field({
      fieldId: 'field-2',
      label: 'Full Name',
      htmlName: 'full_name',
      classification: 'BASIC_PROFILE',
    });
    const newFieldSamePosition = field({
      fieldId: 'field-2',
      label: 'Desired salary',
      htmlName: 'salary',
      classification: 'COMPENSATION',
    });
    expect(fingerprintMatches(fingerprintField(oldFieldOnOldPage), newFieldSamePosition)).toBe(
      false,
    );
  });
});
