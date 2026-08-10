import type { FieldClassification } from '@career-os/shared';

export interface FieldSignals {
  label: string | null;
  name: string | null;
  id: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  nearbyText: string | null;
  sectionHeading: string | null;
  inputType: string;
  selectOptions?: string[];
}

/**
 * Checked in this order because some patterns are substrings of others in normal phrasing
 * (e.g. "work authorization" contains "work", which could otherwise false-match an EXPERIENCE
 * pattern like "work experience") — DEMOGRAPHIC/LEGAL/WORK_AUTHORIZATION are checked first since
 * getting those three right matters most (CLAUDE.md: never suggested / requires approval).
 */
const PATTERNS: [Exclude<FieldClassification, 'AUTHENTICATION' | 'UNKNOWN' | 'FILE_UPLOAD'>, RegExp][] = [
  [
    'DEMOGRAPHIC',
    /race\b|ethnicit|\bgender\b|\bsex\b|disabilit|veteran|sexual orientation|\bpronoun/i,
  ],
  [
    'LEGAL',
    /felon|criminal (record|history|conviction)|convicted of a crime|background check|digital signature|electronically sign|i certify that|i agree to the (terms|conditions)/i,
  ],
  [
    'WORK_AUTHORIZATION',
    /work authorization|authorized to work|require.{0,20}sponsorship|visa sponsorship|work visa|legally (authorized|permitted|eligible) to work/i,
  ],
  ['RELOCATION', /relocat/i],
  ['COMPENSATION', /salary|compensation|pay expectation|desired pay|expected (salary|pay)/i],
  [
    'EDUCATION',
    /\bschool\b|university|college|\bdegree\b|\bgpa\b|graduation|field of study|\bmajor\b/i,
  ],
  [
    'EXPERIENCE',
    // Bare "title"/"company" are checked here (after EDUCATION, before BASIC_PROFILE) because
    // real-world application forms repeat these bare labels inside "Work Experience"/"Projects"
    // add-entry blocks far more often than as a standalone field elsewhere — an imperfect but
    // pragmatic default given the schema has no dedicated "project" classification to fall back
    // to instead (docs/EXTENSION_DESIGN.md's enum is fixed; a bare "Title" is more often a job
    // title than anything else on an application form).
    /employer|company( name)?|job title|\btitle\b|years of experience|current (role|title|position)|work experience|previous employer/i,
  ],
  ['SKILLS', /\bskills?\b|technologies|proficienc/i],
  [
    'BASIC_PROFILE',
    // Negative lookbehind on the bare "name" match excludes "project name" specifically — a
    // real false-positive found testing against a live form (a project's name isn't applicant
    // identity info, and UNKNOWN is a more honest fallback for it than BASIC_PROFILE, given the
    // schema has no dedicated "project" classification — see the EXPERIENCE comment above).
    /full name|first name|last name|(?<!project )\bname\b|\bemail\b|phone\b|linkedin|portfolio|website|\baddress\b/i,
  ],
];

const FREE_RESPONSE_PATTERN =
  /why (do you want|are you interested)|cover letter|tell us about|describe a time/i;

function combinedSignalText(signals: FieldSignals): string {
  return [
    signals.label,
    signals.name,
    signals.id,
    signals.ariaLabel,
    signals.placeholder,
    signals.nearbyText,
    signals.sectionHeading,
    ...(signals.selectOptions ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * AUTHENTICATION is deliberately absent from PATTERNS above — those fields must never reach
 * this function at all (excluded at detection time in detect-fields.ts, per CLAUDE.md "never
 * extract-then-ignore"). If one ever does reach here, that's a bug in the exclusion filter, not
 * something this function should paper over by classifying it correctly anyway.
 */
export function classifyField(signals: FieldSignals): {
  classification: FieldClassification;
  confidence: number;
} {
  if (signals.inputType === 'file') {
    return { classification: 'FILE_UPLOAD', confidence: 0.95 };
  }

  const text = combinedSignalText(signals).toLowerCase();

  for (const [classification, pattern] of PATTERNS) {
    if (pattern.test(text)) {
      return { classification, confidence: 0.8 };
    }
  }

  if (signals.inputType === 'textarea' || FREE_RESPONSE_PATTERN.test(text)) {
    return { classification: 'FREE_RESPONSE', confidence: 0.6 };
  }

  return { classification: 'UNKNOWN', confidence: 0.2 };
}
