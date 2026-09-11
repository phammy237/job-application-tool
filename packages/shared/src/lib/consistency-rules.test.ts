import { describe, expect, it } from 'vitest';
import {
  collapseWhitespace,
  computeFindingId,
  evaluateConsistencyFindings,
  extractGpa,
  extractMonthYear,
  extractYesNoPolarity,
  monthYearFromIsoDate,
  monthYearEqual,
  namesAreEquivalent,
  normalizeCompanyName,
  normalizeTitle,
  type ConsistencyCandidateAnswer,
  type ConsistencyRuleInput,
} from './consistency-rules';
import { consistencyFindingSchema } from '../schemas/consistency-finding';

function answer(
  overrides: Partial<ConsistencyCandidateAnswer> = {},
): ConsistencyCandidateAnswer {
  return {
    generatedAnswerId: '11111111-1111-4111-8111-111111111111',
    fieldLabel: 'Field',
    fieldClassification: 'FREE_RESPONSE',
    text: '',
    ...overrides,
  };
}

function baseInput(overrides: Partial<ConsistencyRuleInput> = {}): ConsistencyRuleInput {
  return {
    answers: [],
    education: [],
    experiences: [],
    profile: { workAuthorization: null, relocationPreference: null },
    ...overrides,
  };
}

// ================================================================================================
// Normalization helpers
// ================================================================================================

describe('extractMonthYear', () => {
  it('parses common equivalent representations to the same value', () => {
    const expected = { year: 2028, month: 5 };
    expect(extractMonthYear('May 2028')).toEqual(expected);
    expect(extractMonthYear('May, 2028')).toEqual(expected);
    expect(extractMonthYear('05/2028')).toEqual(expected);
    expect(extractMonthYear('5/2028')).toEqual(expected);
    expect(extractMonthYear('2028-05')).toEqual(expected);
    expect(extractMonthYear('2028-05-01')).toEqual(expected);
  });

  it('returns null for an incomplete/ambiguous date (year only)', () => {
    expect(extractMonthYear('2028')).toBeNull();
    expect(extractMonthYear('Graduating soon')).toBeNull();
  });

  it('returns null for an invalid month', () => {
    expect(extractMonthYear('13/2028')).toBeNull();
  });

  it('rejects an out-of-range month in ISO form too', () => {
    expect(extractMonthYear('2028-13-01')).toBeNull();
  });
});

describe('monthYearFromIsoDate + monthYearEqual', () => {
  it('reads a stored ISO date and compares equal to the equivalent extracted value', () => {
    const stored = monthYearFromIsoDate('2028-05-01');
    expect(stored).toEqual({ year: 2028, month: 5 });
    expect(monthYearEqual(stored!, extractMonthYear('May 2028')!)).toBe(true);
  });
});

describe('extractGpa', () => {
  it('treats 3.9 and 3.90 as equal after normalization', () => {
    expect(extractGpa('3.9')).toBe(extractGpa('3.90'));
    expect(extractGpa('My GPA is 3.9')).toBe(3.9);
  });

  it('fires on a clearly different GPA', () => {
    expect(extractGpa('3.2')).not.toBe(extractGpa('3.9'));
  });

  it('ignores a malformed/ambiguous string (no decimal point)', () => {
    expect(extractGpa('4')).toBeNull();
    expect(extractGpa('four point oh')).toBeNull();
  });

  it('ignores an out-of-range value', () => {
    expect(extractGpa('9.99')).toBeNull();
  });
});

describe('normalizeCompanyName + namesAreEquivalent', () => {
  it('treats casing/whitespace differences as equivalent', () => {
    expect(
      namesAreEquivalent(normalizeCompanyName('Acme'), normalizeCompanyName('  ACME  ')),
    ).toBe(true);
  });

  it('treats an obvious legal-suffix difference as equivalent ("Deloitte" vs "Deloitte LLP")', () => {
    expect(
      namesAreEquivalent(
        normalizeCompanyName('Deloitte'),
        normalizeCompanyName('Deloitte LLP'),
      ),
    ).toBe(true);
  });

  it('treats genuinely different companies as different', () => {
    expect(
      namesAreEquivalent(
        normalizeCompanyName('Acme Corp'),
        normalizeCompanyName('Globex Inc'),
      ),
    ).toBe(false);
  });
});

describe('normalizeTitle', () => {
  it('is case/whitespace insensitive without mangling the title itself', () => {
    expect(normalizeTitle('Senior  Software Engineer')).toBe(
      normalizeTitle('senior software engineer'),
    );
  });
});

describe('extractYesNoPolarity', () => {
  it('recognizes a bare yes/no', () => {
    expect(extractYesNoPolarity('Yes')).toBe('YES');
    expect(extractYesNoPolarity('no')).toBe('NO');
    expect(extractYesNoPolarity('Yes.')).toBe('YES');
  });

  it('recognizes yes/no as the first word of a sentence', () => {
    expect(extractYesNoPolarity('Yes, I am authorized to work in the US')).toBe('YES');
    expect(extractYesNoPolarity('No, I will require sponsorship')).toBe('NO');
  });

  it('returns UNKNOWN for ambiguous/compound phrasing rather than guessing', () => {
    expect(extractYesNoPolarity('I do not require sponsorship')).toBe('UNKNOWN');
    expect(extractYesNoPolarity('Authorized to work without sponsorship')).toBe(
      'UNKNOWN',
    );
    expect(extractYesNoPolarity('')).toBe('UNKNOWN');
  });
});

describe('collapseWhitespace', () => {
  it('collapses internal whitespace and trims', () => {
    expect(collapseWhitespace('  a   b  ')).toBe('a b');
  });
});

describe('computeFindingId', () => {
  it('is stable across repeated calls with identical inputs', () => {
    expect(computeFindingId(['RULE', 'a', 'b'])).toBe(
      computeFindingId(['RULE', 'a', 'b']),
    );
  });

  it('differs when the inputs differ', () => {
    expect(computeFindingId(['RULE', 'a', 'b'])).not.toBe(
      computeFindingId(['RULE', 'a', 'c']),
    );
  });
});

// ================================================================================================
// GRADUATION_DATE_MISMATCH / GPA_MISMATCH
// ================================================================================================

describe('GRADUATION_DATE_MISMATCH', () => {
  const education = [
    { school: 'State University', graduationDate: '2028-05-15', gpa: null },
  ];

  it('fires a WARNING on a definite mismatch', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education,
        answers: [
          answer({
            fieldClassification: 'EDUCATION',
            fieldLabel: 'Graduation date',
            text: 'June 2027',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('GRADUATION_DATE_MISMATCH');
    expect(findings[0]!.severity).toBe('WARNING');
  });

  it('does not fire on an equivalent format (definite negative)', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education,
        answers: [
          answer({
            fieldClassification: 'EDUCATION',
            fieldLabel: 'Graduation date',
            text: '05/2028',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not fire when the date is ambiguous (year only)', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education,
        answers: [
          answer({
            fieldClassification: 'EDUCATION',
            fieldLabel: 'Graduation date',
            text: '2028',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not fire when there is more than one approved education record (never fuzzy-selects)', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education: [
          ...education,
          { school: 'Other College', graduationDate: '2020-05-01', gpa: null },
        ],
        answers: [
          answer({
            fieldClassification: 'EDUCATION',
            fieldLabel: 'Graduation date',
            text: 'June 2027',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('produces the same finding id for the same conflict evaluated twice', () => {
    const input = baseInput({
      education,
      answers: [
        answer({
          fieldClassification: 'EDUCATION',
          fieldLabel: 'Graduation date',
          text: 'June 2027',
        }),
      ],
    });
    const first = evaluateConsistencyFindings(input);
    const second = evaluateConsistencyFindings(input);
    expect(first[0]!.id).toBe(second[0]!.id);
  });
});

describe('GPA_MISMATCH', () => {
  const education = [{ school: 'State University', graduationDate: null, gpa: '3.9' }];

  it('fires a WARNING on a definite mismatch', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education,
        answers: [
          answer({ fieldClassification: 'EDUCATION', fieldLabel: 'GPA', text: '3.2' }),
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('GPA_MISMATCH');
    expect(findings[0]!.severity).toBe('WARNING');
  });

  it('treats 3.90 and 3.9 as equal (no finding)', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education,
        answers: [
          answer({ fieldClassification: 'EDUCATION', fieldLabel: 'GPA', text: '3.90' }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores a malformed GPA string', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education,
        answers: [
          answer({
            fieldClassification: 'EDUCATION',
            fieldLabel: 'GPA',
            text: 'excellent',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });
});

// ================================================================================================
// EMPLOYMENT_DATE_MISMATCH / JOB_TITLE_COMPANY_MISMATCH
// ================================================================================================

describe('JOB_TITLE_COMPANY_MISMATCH', () => {
  const experiences = [
    {
      company: 'Acme Corp',
      title: 'Backend Engineer',
      startDate: '2020-01-01',
      endDate: null,
    },
  ];

  it('fires on a definite company mismatch', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences,
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Current employer',
            text: 'Globex Inc',
          }),
        ],
      }),
    );
    expect(findings.some((f) => f.ruleId === 'JOB_TITLE_COMPANY_MISMATCH')).toBe(true);
    expect(findings[0]!.severity).toBe('WARNING');
  });

  it('does not fire for an equivalent company name (legal suffix only)', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences,
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Employer',
            text: 'Acme',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('fires on a definite title mismatch', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences,
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Job title',
            text: 'Product Manager',
          }),
        ],
      }),
    );
    expect(findings.some((f) => f.ruleId === 'JOB_TITLE_COMPANY_MISMATCH')).toBe(true);
  });

  it('does not fire when there is more than one approved experience record', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences: [
          ...experiences,
          { company: 'Other Co', title: 'Analyst', startDate: null, endDate: null },
        ],
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Employer',
            text: 'Globex Inc',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not fire for a field whose label is not about company/title', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences,
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Describe your role',
            text: 'Globex Inc',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });
});

describe('EMPLOYMENT_DATE_MISMATCH', () => {
  const experiences = [
    {
      company: 'Acme Corp',
      title: 'Backend Engineer',
      startDate: '2020-01-01',
      endDate: '2022-06-30',
    },
  ];

  it('fires on a definite start-date mismatch', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences,
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Start date',
            text: 'March 2021',
          }),
        ],
      }),
    );
    expect(findings.some((f) => f.ruleId === 'EMPLOYMENT_DATE_MISMATCH')).toBe(true);
  });

  it('does not fire for an equivalent start-date format', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences,
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Start date',
            text: '01/2020',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('fires on a definite end-date mismatch', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        experiences,
        answers: [
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'End date',
            text: 'December 2021',
          }),
        ],
      }),
    );
    expect(findings.some((f) => f.ruleId === 'EMPLOYMENT_DATE_MISMATCH')).toBe(true);
  });
});

// ================================================================================================
// ELIGIBILITY_SELF_CONTRADICTION (BLOCKING) / ELIGIBILITY_PROFILE_MISMATCH (WARNING)
// ================================================================================================

describe('ELIGIBILITY_SELF_CONTRADICTION', () => {
  it('fires BLOCKING when two work-authorization answers in the same application disagree', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        answers: [
          answer({
            generatedAnswerId: 'a',
            fieldClassification: 'WORK_AUTHORIZATION',
            fieldLabel: 'Authorized to work?',
            text: 'Yes',
          }),
          answer({
            generatedAnswerId: 'b',
            fieldClassification: 'WORK_AUTHORIZATION',
            fieldLabel: 'Will you need sponsorship?',
            text: 'No',
          }),
        ],
      }),
    );
    const blocking = findings.filter(
      (f) => f.ruleId === 'ELIGIBILITY_SELF_CONTRADICTION',
    );
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.severity).toBe('BLOCKING');
  });

  it('does not fire when both answers agree (definite negative)', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        answers: [
          answer({
            generatedAnswerId: 'a',
            fieldClassification: 'WORK_AUTHORIZATION',
            text: 'Yes',
          }),
          answer({
            generatedAnswerId: 'b',
            fieldClassification: 'WORK_AUTHORIZATION',
            text: 'Yes',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not fire when polarity is ambiguous for one of the two answers', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        answers: [
          answer({
            generatedAnswerId: 'a',
            fieldClassification: 'WORK_AUTHORIZATION',
            text: 'Yes',
          }),
          answer({
            generatedAnswerId: 'b',
            fieldClassification: 'WORK_AUTHORIZATION',
            text: 'I do not require sponsorship',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('a BLOCKING self-contradiction finding has a stable id across re-evaluation', () => {
    const input = baseInput({
      answers: [
        answer({
          generatedAnswerId: 'a',
          fieldClassification: 'WORK_AUTHORIZATION',
          text: 'Yes',
        }),
        answer({
          generatedAnswerId: 'b',
          fieldClassification: 'WORK_AUTHORIZATION',
          text: 'No',
        }),
      ],
    });
    const first = evaluateConsistencyFindings(input);
    const second = evaluateConsistencyFindings(input);
    expect(first[0]!.id).toBe(second[0]!.id);
  });
});

describe('ELIGIBILITY_PROFILE_MISMATCH', () => {
  it('fires WARNING when a confident answer disagrees with a confident profile value', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        profile: { workAuthorization: 'No', relocationPreference: null },
        answers: [answer({ fieldClassification: 'WORK_AUTHORIZATION', text: 'Yes' })],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('ELIGIBILITY_PROFILE_MISMATCH');
    expect(findings[0]!.severity).toBe('WARNING');
  });

  it('does not fire when the profile value is free text with no confident polarity (when uncertain: no finding)', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        profile: {
          workAuthorization: 'H1B visa, requires transfer',
          relocationPreference: null,
        },
        answers: [answer({ fieldClassification: 'WORK_AUTHORIZATION', text: 'Yes' })],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('does not fire when there is no profile value at all', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        answers: [answer({ fieldClassification: 'WORK_AUTHORIZATION', text: 'Yes' })],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('work authorization tags the profile side PROFILE_ELIGIBILITY, not the old PROFILE_CONTACT misnomer', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        profile: { workAuthorization: 'No', relocationPreference: null },
        answers: [answer({ fieldClassification: 'WORK_AUTHORIZATION', text: 'Yes' })],
      }),
    );
    expect(findings[0]!.fieldBSource).toBe('PROFILE_ELIGIBILITY');
  });
});

// ================================================================================================
// RELOCATION_SELF_CONTRADICTION (BLOCKING) / RELOCATION_PROFILE_MISMATCH (WARNING) — Phase 5B
// hardening: relocation now gets its own dedicated rule ids, distinct from
// ELIGIBILITY_SELF_CONTRADICTION/ELIGIBILITY_PROFILE_MISMATCH, which remain reserved for
// WORK_AUTHORIZATION only. Mirrors the WORK_AUTHORIZATION test suite above one-for-one, on the
// same evaluateEligibilityGroup code path with a different classification.
// ================================================================================================

describe('RELOCATION_SELF_CONTRADICTION', () => {
  it('fires BLOCKING (with its own dedicated rule id, never ELIGIBILITY_SELF_CONTRADICTION) when two relocation answers in the same application disagree', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        answers: [
          answer({
            generatedAnswerId: 'a',
            fieldClassification: 'RELOCATION',
            fieldLabel: 'Willing to relocate?',
            text: 'Yes',
          }),
          answer({
            generatedAnswerId: 'b',
            fieldClassification: 'RELOCATION',
            fieldLabel: 'Open to moving for this role?',
            text: 'No',
          }),
        ],
      }),
    );
    const blocking = findings.filter((f) => f.ruleId === 'RELOCATION_SELF_CONTRADICTION');
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.severity).toBe('BLOCKING');
    expect(findings.some((f) => f.ruleId === 'ELIGIBILITY_SELF_CONTRADICTION')).toBe(
      false,
    );
  });

  it('does not fire when both relocation answers agree', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        answers: [
          answer({
            generatedAnswerId: 'a',
            fieldClassification: 'RELOCATION',
            text: 'Yes',
          }),
          answer({
            generatedAnswerId: 'b',
            fieldClassification: 'RELOCATION',
            text: 'Yes',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it('a relocation self-contradiction finding has a stable id across re-evaluation, and never collides with the equivalent work-authorization id for the same answer ids', () => {
    const input = baseInput({
      answers: [
        answer({
          generatedAnswerId: 'a',
          fieldClassification: 'RELOCATION',
          text: 'Yes',
        }),
        answer({ generatedAnswerId: 'b', fieldClassification: 'RELOCATION', text: 'No' }),
      ],
    });
    const first = evaluateConsistencyFindings(input);
    const second = evaluateConsistencyFindings(input);
    expect(first[0]!.id).toBe(second[0]!.id);

    const workAuthInput = baseInput({
      answers: [
        answer({
          generatedAnswerId: 'a',
          fieldClassification: 'WORK_AUTHORIZATION',
          text: 'Yes',
        }),
        answer({
          generatedAnswerId: 'b',
          fieldClassification: 'WORK_AUTHORIZATION',
          text: 'No',
        }),
      ],
    });
    const workAuthFindings = evaluateConsistencyFindings(workAuthInput);
    // Same answer ids, same polarity shape, different classification -> different ruleId -> a
    // provably different finding id (the whole point of the rule-id split).
    expect(first[0]!.id).not.toBe(workAuthFindings[0]!.id);
  });
});

describe('RELOCATION_PROFILE_MISMATCH', () => {
  it('fires WARNING with the dedicated relocation rule id (never the shared ELIGIBILITY_PROFILE_MISMATCH id) when a confident relocation answer disagrees with a confident profile value', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        profile: { workAuthorization: null, relocationPreference: 'No' },
        answers: [answer({ fieldClassification: 'RELOCATION', text: 'Yes' })],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('RELOCATION_PROFILE_MISMATCH');
    expect(findings[0]!.severity).toBe('WARNING');
    expect(findings[0]!.fieldBSource).toBe('PROFILE_ELIGIBILITY');
  });

  it('does not fire when the relocation profile value has no confident polarity', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        profile: {
          workAuthorization: null,
          relocationPreference: 'Open to some locations',
        },
        answers: [answer({ fieldClassification: 'RELOCATION', text: 'Yes' })],
      }),
    );
    expect(findings).toHaveLength(0);
  });
});

describe('ConsistencyRuleId backward compatibility with historical packets', () => {
  it('the shared consistencyFindingSchema still parses a historical finding using the pre-split shared ids and the old PROFILE_CONTACT source', () => {
    const historicalFinding = {
      id: 'abc123',
      ruleId: 'ELIGIBILITY_PROFILE_MISMATCH',
      severity: 'WARNING',
      fieldALabel: 'Willing to relocate?',
      fieldASource: 'GENERATED_ANSWER',
      fieldAValue: 'Yes',
      fieldBLabel: 'Profile relocation preference',
      fieldBSource: 'PROFILE_CONTACT',
      fieldBValue: 'No',
      description:
        'A pre-hardening relocation finding, frozen under the old shared rule id.',
    };
    expect(() => consistencyFindingSchema.parse(historicalFinding)).not.toThrow();
  });

  it('still parses a historical BLOCKING work-authorization finding using ELIGIBILITY_SELF_CONTRADICTION', () => {
    const historicalFinding = {
      id: 'def456',
      ruleId: 'ELIGIBILITY_SELF_CONTRADICTION',
      severity: 'BLOCKING',
      fieldALabel: 'Authorized to work?',
      fieldASource: 'GENERATED_ANSWER',
      fieldAValue: 'Yes',
      fieldBLabel: 'Need sponsorship?',
      fieldBSource: 'GENERATED_ANSWER',
      fieldBValue: 'No',
      description: 'A pre-hardening work-authorization contradiction.',
    };
    expect(() => consistencyFindingSchema.parse(historicalFinding)).not.toThrow();
  });
});

describe('evaluateConsistencyFindings — wording differences never trigger', () => {
  it('produces no findings for a fully consistent set of realistic answers', () => {
    const findings = evaluateConsistencyFindings(
      baseInput({
        education: [
          { school: 'State University', graduationDate: '2028-05-15', gpa: '3.9' },
        ],
        experiences: [
          {
            company: 'Acme Corp',
            title: 'Backend Engineer',
            startDate: '2020-01-01',
            endDate: null,
          },
        ],
        profile: { workAuthorization: 'Yes', relocationPreference: 'Yes' },
        answers: [
          answer({
            fieldClassification: 'EDUCATION',
            fieldLabel: 'Graduation date',
            text: 'May 2028',
          }),
          answer({ fieldClassification: 'EDUCATION', fieldLabel: 'GPA', text: '3.90' }),
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Employer',
            text: 'Acme Corp LLC',
          }),
          answer({
            fieldClassification: 'EXPERIENCE',
            fieldLabel: 'Job title',
            text: 'backend engineer',
          }),
          answer({
            fieldClassification: 'WORK_AUTHORIZATION',
            fieldLabel: 'Authorized?',
            text: 'Yes',
          }),
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });
});
