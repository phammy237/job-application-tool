import type { Application, EmailSignal } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import { matchApplication } from './matcher';

const USER_ID = '22222222-2222-4222-8222-222222222222';

function makeApplication(
  overrides: Partial<Application> & { id: string; company: string; title: string },
): Application {
  return {
    userId: USER_ID,
    jobId: null,
    resumeId: null,
    status: 'IN_PROGRESS',
    notes: null,
    appliedAt: null,
    location: null,
    sourceUrl: null,
    canonicalUrl: null,
    atsProvider: null,
    externalId: null,
    autofillSummary: null,
    unresolvedFields: null,
    jobSnapshotId: null,
    submissionPacketId: null,
    workingResumeVersionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSignal(
  overrides: Partial<EmailSignal> & { matchedApplicationId: string },
): EmailSignal {
  return {
    id: 'sig-1',
    userId: USER_ID,
    emailConnectionId: 'conn-1',
    providerMessageId: 'msg-1',
    sender: null,
    senderDomain: null,
    subject: null,
    receivedAt: null,
    classification: null,
    confidence: null,
    evidence: null,
    confirmationStatus: 'CONFIRMED',
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchApplication — clean single match', () => {
  it('matches on company-domain-guess plus token overlap', () => {
    const acme = makeApplication({
      id: 'app-acme',
      company: 'Acme',
      title: 'Backend Engineer',
    });
    const other = makeApplication({
      id: 'app-other',
      company: 'Globex',
      title: 'Frontend Engineer',
    });

    const result = matchApplication(
      {
        sender: 'careers@acme.com',
        senderDomain: 'acme.com',
        subject: 'Your application to Acme — Backend Engineer',
      },
      [acme, other],
      [],
    );

    expect(result.applicationId).toBe('app-acme');
    expect(result.ambiguous).toBe(false);
    expect(result.score).toBeGreaterThan(0.5);
  });
});

describe('matchApplication — zero match', () => {
  it('returns a null applicationId when nothing overlaps', () => {
    const acme = makeApplication({
      id: 'app-acme',
      company: 'Acme',
      title: 'Backend Engineer',
    });

    const result = matchApplication(
      {
        sender: 'newsletter@unrelated.example',
        senderDomain: 'unrelated.example',
        subject: 'Weekly job digest',
      },
      [acme],
      [],
    );

    expect(result).toEqual({ applicationId: null, score: 0, ambiguous: false });
  });

  it('returns a null applicationId when there are no eligible (non-WITHDRAWN) applications', () => {
    const withdrawn = makeApplication({
      id: 'app-w',
      company: 'Acme',
      title: 'Backend Engineer',
      status: 'WITHDRAWN',
    });

    const result = matchApplication(
      {
        sender: 'careers@acme.com',
        senderDomain: 'acme.com',
        subject: 'Your application to Acme',
      },
      [withdrawn],
      [],
    );

    expect(result).toEqual({ applicationId: null, score: 0, ambiguous: false });
  });
});

describe('matchApplication — ambiguous multi-match', () => {
  it('flags ambiguous when two applications score within the margin and neither clears the auto-apply threshold', () => {
    const acmeA = makeApplication({
      id: 'app-a',
      company: 'Acme',
      title: 'Backend Engineer',
    });
    const acmeB = makeApplication({
      id: 'app-b',
      company: 'Acme',
      title: 'Platform Engineer',
    });

    // Same company for both — sender/subject only weakly distinguishes the two roles, so neither
    // application's title tokens land a clean win and both score identically off the company
    // overlap + domain guess alone.
    const result = matchApplication(
      {
        sender: 'careers@acme.com',
        senderDomain: 'acme.com',
        subject: 'Update on your Acme application',
      },
      [acmeA, acmeB],
      [],
    );

    expect(result.ambiguous).toBe(true);
  });
});

describe('matchApplication — domain learned from a prior confirmed signal', () => {
  it('matches via a learned ATS sending domain even when the company-name domain guess would not match', () => {
    const acme = makeApplication({
      id: 'app-acme',
      company: 'Acme',
      title: 'Backend Engineer',
    });
    const priorSignal = makeSignal({
      matchedApplicationId: 'app-acme',
      senderDomain: 'myworkday.com',
      confirmationStatus: 'CONFIRMED',
    });

    const result = matchApplication(
      {
        sender: 'no-reply@myworkday.com',
        senderDomain: 'myworkday.com',
        subject: 'Application status update',
      },
      [acme],
      [priorSignal],
    );

    expect(result.applicationId).toBe('app-acme');
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it('does not learn from a DECLINED or PENDING prior signal', () => {
    const acme = makeApplication({
      id: 'app-acme',
      company: 'Acme',
      title: 'Backend Engineer',
    });
    const declinedSignal = makeSignal({
      matchedApplicationId: 'app-acme',
      senderDomain: 'myworkday.com',
      confirmationStatus: 'DECLINED',
    });

    const result = matchApplication(
      {
        sender: 'no-reply@myworkday.com',
        senderDomain: 'myworkday.com',
        subject: 'Unrelated notice',
      },
      [acme],
      [declinedSignal],
    );

    expect(result).toEqual({ applicationId: null, score: 0, ambiguous: false });
  });
});
