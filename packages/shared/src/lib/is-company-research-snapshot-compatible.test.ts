import { describe, expect, it } from 'vitest';
import type { CompanyResearchSnapshot } from '../schemas/company-research';
import { isCompanyResearchSnapshotCompatible } from './is-company-research-snapshot-compatible';

function snapshot(overrides: Partial<CompanyResearchSnapshot> = {}): CompanyResearchSnapshot {
  return {
    id: 'snap-1',
    userId: 'user-1',
    applicationId: 'app-1',
    companyName: 'Acme',
    roleTitle: 'Software Engineer',
    jobSnapshotId: 'job-snap-1',
    researchedAt: '2026-09-10T00:00:00.000Z',
    createdAt: '2026-09-10T00:00:00.000Z',
    findings: [],
    sources: [],
    ...overrides,
  };
}

describe('isCompanyResearchSnapshotCompatible', () => {
  it('is compatible when company and job snapshot both match', () => {
    expect(
      isCompanyResearchSnapshotCompatible(snapshot(), {
        company: 'Acme',
        title: 'Software Engineer',
        jobSnapshotId: 'job-snap-1',
      }),
    ).toBe(true);
  });

  it('is case/whitespace-insensitive on company name', () => {
    expect(
      isCompanyResearchSnapshotCompatible(snapshot({ companyName: '  ACME  ' }), {
        company: 'acme',
        title: 'Software Engineer',
        jobSnapshotId: 'job-snap-1',
      }),
    ).toBe(true);
  });

  it('is incompatible when the company no longer matches', () => {
    expect(
      isCompanyResearchSnapshotCompatible(snapshot(), {
        company: 'A Totally Different Company',
        title: 'Software Engineer',
        jobSnapshotId: 'job-snap-1',
      }),
    ).toBe(false);
  });

  it('when the snapshot has a jobSnapshotId, that alone decides compatibility — roleTitle is not separately checked', () => {
    expect(
      isCompanyResearchSnapshotCompatible(snapshot({ roleTitle: 'A Completely Different Title' }), {
        company: 'Acme',
        title: 'Software Engineer',
        jobSnapshotId: 'job-snap-1',
      }),
    ).toBe(true);
  });

  it('is incompatible when the snapshot has a jobSnapshotId but the application now points at a different one', () => {
    expect(
      isCompanyResearchSnapshotCompatible(snapshot(), {
        company: 'Acme',
        title: 'Software Engineer',
        jobSnapshotId: 'a-different-job-snapshot',
      }),
    ).toBe(false);
  });

  it('is incompatible when the application has no job snapshot at all but the research snapshot recorded one', () => {
    expect(
      isCompanyResearchSnapshotCompatible(snapshot(), {
        company: 'Acme',
        title: 'Software Engineer',
        jobSnapshotId: null,
      }),
    ).toBe(false);
  });

  it('falls back to roleTitle when the snapshot has no jobSnapshotId', () => {
    const noJobSnapshot = snapshot({ jobSnapshotId: null });
    expect(
      isCompanyResearchSnapshotCompatible(noJobSnapshot, {
        company: 'Acme',
        title: 'Software Engineer',
        jobSnapshotId: null,
      }),
    ).toBe(true);
    expect(
      isCompanyResearchSnapshotCompatible(noJobSnapshot, {
        company: 'Acme',
        title: 'A Different Title',
        jobSnapshotId: null,
      }),
    ).toBe(false);
  });

  it('does not require applicationId to match — a re-applied/historical snapshot can still be reused', () => {
    const historical = snapshot({ applicationId: null });
    expect(
      isCompanyResearchSnapshotCompatible(historical, {
        company: 'Acme',
        title: 'Software Engineer',
        jobSnapshotId: 'job-snap-1',
      }),
    ).toBe(true);
  });
});
