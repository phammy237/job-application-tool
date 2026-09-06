import type { EmailClassification } from '@career-os/shared';

export interface LabeledEmailFixture {
  label: string;
  subject: string;
  snippet: string;
  expectedClassification: EmailClassification | null;
}

/** A representative fixture set covering the common ATS-generated phrasing for each
 * classification, plus a handful of deliberately ambiguous cases that should fall through to
 * the Claude fallback (expectedClassification: null). */
export const LABELED_EMAILS: LabeledEmailFixture[] = [
  {
    label: 'application received — standard ATS confirmation',
    subject: 'Thank you for applying to Acme',
    snippet: 'We have received your application for the Backend Engineer role and will be in touch.',
    expectedClassification: 'APPLICATION_RECEIVED',
  },
  {
    label: 'application submitted confirmation',
    subject: 'Your application has been submitted',
    snippet: 'Thanks for your interest in Acme Corp.',
    expectedClassification: 'APPLICATION_RECEIVED',
  },
  {
    label: 'assessment — coding challenge',
    subject: 'Next steps: coding challenge',
    snippet: 'Please complete the attached coding challenge within 5 days.',
    expectedClassification: 'ASSESSMENT',
  },
  {
    label: 'assessment — take-home',
    subject: 'Take-home assignment for Backend Engineer',
    snippet: "Here's your take-home assignment.",
    expectedClassification: 'ASSESSMENT',
  },
  {
    label: 'interview — scheduling',
    subject: 'Interview availability',
    snippet: "We'd like to schedule an interview with you next week.",
    expectedClassification: 'INTERVIEW',
  },
  {
    label: 'interview — phone screen',
    subject: 'Quick phone screen?',
    snippet: 'Our recruiter would like to schedule a call to discuss your background.',
    expectedClassification: 'INTERVIEW',
  },
  {
    label: 'action required — missing document',
    subject: 'Action required: missing document',
    snippet: 'Please complete the attached form to continue your application.',
    expectedClassification: 'ACTION_REQUIRED',
  },
  {
    label: 'offer — formal offer letter',
    subject: 'Your offer from Acme',
    snippet: 'We are pleased to offer you the position of Backend Engineer.',
    expectedClassification: 'OFFER',
  },
  {
    label: 'rejected — standard rejection',
    subject: 'Update on your application',
    snippet: 'After careful consideration, we have decided to move forward with other candidates.',
    expectedClassification: 'REJECTED',
  },
  {
    label: 'rejected — position filled',
    subject: 'Regarding your application',
    snippet: 'This position has been filled.',
    expectedClassification: 'REJECTED',
  },
  {
    label: 'ambiguous — vague follow-up with no decisive phrase',
    subject: 'Following up',
    snippet: 'Just wanted to check in on where things stand with your candidacy.',
    expectedClassification: null,
  },
  {
    label: 'ambiguous — newsletter-adjacent wording without a clear signal',
    subject: 'New roles you might like',
    snippet: 'Here are some new opportunities that match your profile.',
    expectedClassification: null,
  },
];
