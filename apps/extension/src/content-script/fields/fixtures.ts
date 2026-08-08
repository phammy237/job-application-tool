import type { FieldClassification } from '@career-os/shared';
import type { FieldSignals } from './classify-field';

function signals(overrides: Partial<FieldSignals>): FieldSignals {
  return {
    label: null,
    name: null,
    id: null,
    ariaLabel: null,
    placeholder: null,
    nearbyText: null,
    sectionHeading: null,
    inputType: 'text',
    ...overrides,
  };
}

export const classificationFixtures: {
  description: string;
  signals: FieldSignals;
  expected: FieldClassification;
}[] = [
  {
    description: 'full name field',
    signals: signals({ label: 'Full Name', name: 'full_name' }),
    expected: 'BASIC_PROFILE',
  },
  {
    description: 'email field',
    signals: signals({ label: 'Email address', name: 'email', inputType: 'email' }),
    expected: 'BASIC_PROFILE',
  },
  {
    description: 'school field',
    signals: signals({ label: 'School', name: 'school' }),
    expected: 'EDUCATION',
  },
  {
    description: 'current employer field',
    signals: signals({ label: 'Current Employer', name: 'employer' }),
    expected: 'EXPERIENCE',
  },
  {
    description: 'skills field with select options',
    signals: signals({
      label: 'Skills',
      name: 'skills',
      inputType: 'select-one',
      selectOptions: ['TypeScript', 'Go', 'Python'],
    }),
    expected: 'SKILLS',
  },
  {
    description: 'work authorization question',
    signals: signals({
      label: 'Are you legally authorized to work in the United States?',
      name: 'work_auth',
    }),
    expected: 'WORK_AUTHORIZATION',
  },
  {
    description: 'relocation question',
    signals: signals({ label: 'Are you willing to relocate?', name: 'relocation' }),
    expected: 'RELOCATION',
  },
  {
    description: 'desired salary field',
    signals: signals({ label: 'Desired salary', name: 'desired_salary' }),
    expected: 'COMPENSATION',
  },
  {
    description: 'gender field — must never be suggested, but must still classify correctly',
    signals: signals({ label: 'Gender', name: 'gender', inputType: 'select-one' }),
    expected: 'DEMOGRAPHIC',
  },
  {
    description: 'veteran status field',
    signals: signals({ label: 'Veteran status', name: 'veteran_status' }),
    expected: 'DEMOGRAPHIC',
  },
  {
    description: 'criminal history attestation',
    signals: signals({
      label: 'Have you ever been convicted of a felony?',
      name: 'criminal_history',
    }),
    expected: 'LEGAL',
  },
  {
    description: 'digital signature field',
    signals: signals({
      label: 'I certify that the above information is true. Please sign below.',
      name: 'signature',
    }),
    expected: 'LEGAL',
  },
  {
    description: 'resume upload',
    signals: signals({ label: 'Resume', name: 'resume', inputType: 'file' }),
    expected: 'FILE_UPLOAD',
  },
  {
    description: 'cover letter free-response question',
    signals: signals({
      label: 'Why do you want to work here?',
      name: 'cover_letter',
      inputType: 'textarea',
    }),
    expected: 'FREE_RESPONSE',
  },
  {
    description: 'any textarea with no other matching signal falls back to FREE_RESPONSE',
    signals: signals({ label: 'Additional notes', name: 'notes', inputType: 'textarea' }),
    expected: 'FREE_RESPONSE',
  },
  {
    description: 'a field with no recognizable signal falls back to UNKNOWN',
    signals: signals({ label: 'Favorite color', name: 'favorite_color' }),
    expected: 'UNKNOWN',
  },
];
