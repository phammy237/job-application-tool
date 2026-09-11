import { describe, expect, it } from 'vitest';
import type { Application, ApplicationEvent } from '@career-os/shared';
import {
  attachNextActions,
  needsAttention,
  sortApplicationsByAttention,
  stageGroupForStatus,
  toRecentActivity,
} from './dashboard';

const NOW = '2026-06-15T00:00:00.000Z';

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    userId: 'user-1',
    jobId: null,
    resumeId: null,
    company: 'Acme',
    title: 'Backend Engineer',
    status: 'SAVED',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<ApplicationEvent> = {}): ApplicationEvent {
  return {
    id: 'event-1',
    userId: 'user-1',
    applicationId: 'app-1',
    eventType: 'STATUS_CHANGE',
    fromStatus: 'SAVED',
    toStatus: 'IN_PROGRESS',
    source: 'USER',
    emailSignalId: null,
    revertedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('attachNextActions', () => {
  it('derives one NextAction per application, in the same order', () => {
    const apps = [
      application({ id: 'a', status: 'OFFER' }),
      application({ id: 'b', status: 'REJECTED' }),
    ];
    const result = attachNextActions(apps, NOW);
    expect(result).toHaveLength(2);
    expect(result[0]!.application.id).toBe('a');
    expect(result[0]!.nextAction.type).toBe('REVIEW_OFFER');
    expect(result[1]!.nextAction.type).toBe('NO_ACTION');
  });
});

describe('sortApplicationsByAttention', () => {
  it('sorts URGENT before NONE', () => {
    const items = attachNextActions(
      [
        application({ id: 'rejected', status: 'REJECTED' }),
        application({ id: 'action-required', status: 'ACTION_REQUIRED' }),
      ],
      NOW,
    );
    const sorted = sortApplicationsByAttention(items).map((i) => i.application.id);
    expect(sorted).toEqual(['action-required', 'rejected']);
  });

  it('does not mutate the input array', () => {
    const items = attachNextActions(
      [
        application({ id: 'a', status: 'REJECTED' }),
        application({ id: 'b', status: 'OFFER' }),
      ],
      NOW,
    );
    const original = [...items];
    sortApplicationsByAttention(items);
    expect(items).toEqual(original);
  });
});

describe('needsAttention', () => {
  it('is true for URGENT/HIGH/MEDIUM, false for LOW and NONE', () => {
    const [actionRequired, assessment, unresolved, rejected, followUp, complete] =
      attachNextActions(
        [
          application({ id: 'action-required', status: 'ACTION_REQUIRED' }),
          application({ id: 'assessment', status: 'ASSESSMENT' }),
          application({
            id: 'unresolved',
            status: 'IN_PROGRESS',
            unresolvedFields: [
              {
                label: 'x',
                classification: 'FREE_RESPONSE',
                status: 'NEEDS_INPUT',
                reason: 'r',
              },
            ],
          }),
          application({ id: 'rejected', status: 'REJECTED' }),
          application({
            id: 'follow-up',
            status: 'APPLIED',
            appliedAt: '2026-01-01T00:00:00.000Z',
          }),
          application({ id: 'complete', status: 'SAVED' }),
        ],
        NOW,
      );
    expect(needsAttention(actionRequired!)).toBe(true);
    expect(needsAttention(assessment!)).toBe(true);
    expect(needsAttention(unresolved!)).toBe(true);
    expect(needsAttention(rejected!)).toBe(false);
    // CONSIDER_FOLLOW_UP is LOW priority — a recommendation, not an urgent need.
    expect(followUp!.nextAction.type).toBe('CONSIDER_FOLLOW_UP');
    expect(needsAttention(followUp!)).toBe(false);
    expect(complete!.nextAction.type).toBe('COMPLETE_APPLICATION');
    expect(needsAttention(complete!)).toBe(false);
  });
});

describe('stageGroupForStatus', () => {
  it.each([
    ['SAVED', 'PREPARING'],
    ['IN_PROGRESS', 'PREPARING'],
    ['APPLIED', 'APPLIED'],
    ['APPLICATION_RECEIVED', 'APPLIED'],
    ['ASSESSMENT', 'ACTIVE_PROCESS'],
    ['INTERVIEW', 'ACTIVE_PROCESS'],
    ['ACTION_REQUIRED', 'ACTIVE_PROCESS'],
    ['OFFER', 'OFFER'],
    ['REJECTED', 'CLOSED'],
    ['WITHDRAWN', 'CLOSED'],
  ] as const)('%s -> %s', (status, expectedGroup) => {
    expect(stageGroupForStatus(status)).toBe(expectedGroup);
  });

  it('UNKNOWN is not silently forced into a misleading bucket', () => {
    expect(stageGroupForStatus('UNKNOWN')).toBe('OTHER');
  });
});

describe('toRecentActivity', () => {
  it('maps an event to its application company/title using the already-fetched list, no join', () => {
    const apps = [application({ id: 'app-1', company: 'Acme', title: 'Engineer' })];
    const events = [event({ applicationId: 'app-1' })];
    const result = toRecentActivity(events, apps);
    expect(result).toEqual([
      { event: events[0], applicationId: 'app-1', company: 'Acme', title: 'Engineer' },
    ]);
  });

  it('drops an event whose application no longer exists rather than showing a broken row', () => {
    const result = toRecentActivity([event({ applicationId: 'ghost' })], []);
    expect(result).toEqual([]);
  });

  it('drops non-STATUS_CHANGE events — only real status transitions are dashboard activity', () => {
    const apps = [application({ id: 'app-1' })];
    const result = toRecentActivity(
      [event({ applicationId: 'app-1', eventType: 'NOTE' })],
      apps,
    );
    expect(result).toEqual([]);
  });

  it('drops a reverted event — it is no longer the current truth about what happened', () => {
    const apps = [application({ id: 'app-1' })];
    const result = toRecentActivity(
      [event({ applicationId: 'app-1', revertedAt: '2026-01-02T00:00:00.000Z' })],
      apps,
    );
    expect(result).toEqual([]);
  });
});
