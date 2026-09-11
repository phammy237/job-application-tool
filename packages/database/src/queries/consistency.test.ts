import { describe, expect, it } from 'vitest';
import type { ConsistencyFinding } from '@career-os/shared';
import { ConsistencyCheckFailedError, enforceConsistencyGate } from './consistency';

function warning(id: string): ConsistencyFinding {
  return {
    id,
    ruleId: 'GPA_MISMATCH',
    severity: 'WARNING',
    fieldALabel: 'A',
    fieldASource: 'GENERATED_ANSWER',
    fieldAValue: '3.2',
    fieldBLabel: 'B',
    fieldBSource: 'PROFILE_EDUCATION',
    fieldBValue: '3.9',
    description: 'Mismatch',
  };
}

function blocking(id: string): ConsistencyFinding {
  return {
    id,
    ruleId: 'ELIGIBILITY_SELF_CONTRADICTION',
    severity: 'BLOCKING',
    fieldALabel: 'A',
    fieldASource: 'GENERATED_ANSWER',
    fieldAValue: 'Yes',
    fieldBLabel: 'B',
    fieldBSource: 'GENERATED_ANSWER',
    fieldBValue: 'No',
    description: 'Contradiction',
  };
}

describe('enforceConsistencyGate', () => {
  it('returns no acknowledgements for a clean (empty findings) application', () => {
    expect(enforceConsistencyGate([], [])).toEqual([]);
  });

  it('throws blocking_findings whenever any BLOCKING finding is present', () => {
    expect(() => enforceConsistencyGate([blocking('b1')], [])).toThrow(
      ConsistencyCheckFailedError,
    );
    try {
      enforceConsistencyGate([blocking('b1')], []);
    } catch (error) {
      expect(error).toBeInstanceOf(ConsistencyCheckFailedError);
      expect((error as ConsistencyCheckFailedError).reason).toBe('blocking_findings');
    }
  });

  it('a BLOCKING finding cannot be satisfied by passing its id as an acknowledgement', () => {
    expect(() => enforceConsistencyGate([blocking('b1')], ['b1'])).toThrow(
      ConsistencyCheckFailedError,
    );
  });

  it('BLOCKING takes priority over WARNING — a mix always rejects on blocking_findings first', () => {
    try {
      enforceConsistencyGate([blocking('b1'), warning('w1')], ['w1']);
      throw new Error('expected enforceConsistencyGate to throw');
    } catch (error) {
      expect((error as ConsistencyCheckFailedError).reason).toBe('blocking_findings');
    }
  });

  it('throws unacknowledged_warnings when a WARNING finding has no matching acknowledgement', () => {
    try {
      enforceConsistencyGate([warning('w1')], []);
      throw new Error('expected enforceConsistencyGate to throw');
    } catch (error) {
      expect((error as ConsistencyCheckFailedError).reason).toBe(
        'unacknowledged_warnings',
      );
    }
  });

  it('a stale/invented acknowledgement id does not satisfy a real current warning', () => {
    expect(() => enforceConsistencyGate([warning('w1')], ['not-w1'])).toThrow(
      ConsistencyCheckFailedError,
    );
  });

  it('requires every current WARNING to be acknowledged, not just one of several', () => {
    expect(() => enforceConsistencyGate([warning('w1'), warning('w2')], ['w1'])).toThrow(
      ConsistencyCheckFailedError,
    );
  });

  it('returns one acknowledgement record per acknowledged warning when the gate passes', () => {
    const result = enforceConsistencyGate([warning('w1'), warning('w2')], ['w1', 'w2']);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.findingId).sort()).toEqual(['w1', 'w2']);
    for (const ack of result) {
      expect(() => new Date(ack.acknowledgedAt).toISOString()).not.toThrow();
    }
  });

  it('ignores an acknowledgement id that does not correspond to any current finding, without affecting the others', () => {
    const result = enforceConsistencyGate([warning('w1')], ['w1', 'some-unrelated-id']);
    expect(result).toEqual([expect.objectContaining({ findingId: 'w1' })]);
  });
});
