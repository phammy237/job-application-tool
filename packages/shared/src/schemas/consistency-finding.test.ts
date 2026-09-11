import { describe, expect, it } from 'vitest';
import { AI_ASSISTED_RULE_IDS, consistencyFindingSchema } from './consistency-finding';

function baseFinding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'f1',
    ruleId: 'GPA_MISMATCH',
    severity: 'WARNING',
    fieldALabel: 'GPA',
    fieldASource: 'GENERATED_ANSWER',
    fieldAValue: '3.2',
    fieldBLabel: 'GPA',
    fieldBSource: 'PROFILE_EDUCATION',
    fieldBValue: '3.9',
    description: 'Mismatch',
    ...overrides,
  };
}

describe('consistencyFindingSchema — AI-assisted severity guard (Phase 5B hardening)', () => {
  it('parses UNSUPPORTED_CLAIM + WARNING successfully', () => {
    const result = consistencyFindingSchema.safeParse(
      baseFinding({ ruleId: 'UNSUPPORTED_CLAIM', severity: 'WARNING' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects UNSUPPORTED_CLAIM + BLOCKING — schema validation fails, never silently accepted', () => {
    const result = consistencyFindingSchema.safeParse(
      baseFinding({ ruleId: 'UNSUPPORTED_CLAIM', severity: 'BLOCKING' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['severity']);
      expect(result.error.issues[0]?.message).toMatch(/can never be BLOCKING/);
    }
  });

  it('still allows a genuinely deterministic rule to be BLOCKING (the guard is scoped to AI_ASSISTED_RULE_IDS only, never a blanket ban)', () => {
    const result = consistencyFindingSchema.safeParse(
      baseFinding({ ruleId: 'ELIGIBILITY_SELF_CONTRADICTION', severity: 'BLOCKING' }),
    );
    expect(result.success).toBe(true);
  });

  it('AI_ASSISTED_RULE_IDS contains exactly UNSUPPORTED_CLAIM today — the guard automatically covers any future addition to that set without further schema changes', () => {
    expect([...AI_ASSISTED_RULE_IDS]).toEqual(['UNSUPPORTED_CLAIM']);
  });
});
