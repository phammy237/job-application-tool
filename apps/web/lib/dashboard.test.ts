import { describe, expect, it } from 'vitest';
import type { Application, ApplicationEvent } from '@career-os/shared';
import {
  attachNextActions,
  buildLastRelevantStatusActivityMap,
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
    const result = attachNextActions(apps, [], NOW);
    expect(result).toHaveLength(2);
    expect(result[0]!.application.id).toBe('a');
    expect(result[0]!.nextAction.type).toBe('REVIEW_OFFER');
    expect(result[1]!.nextAction.type).toBe('NO_ACTION');
  });

  // F. Gmail-confirmed APPLICATION_RECEIVED resets the anchor.
  it('F: a Gmail-confirmed (source=GMAIL_SYNC) APPLICATION_RECEIVED transition resets the follow-up anchor', () => {
    const apps = [
      application({
        id: 'app-1',
        status: 'APPLICATION_RECEIVED',
        appliedAt: '2026-06-05T00:00:00.000Z', // 10 days before NOW
      }),
    ];
    const events = [
      event({
        applicationId: 'app-1',
        source: 'GMAIL_SYNC',
        toStatus: 'APPLICATION_RECEIVED',
        createdAt: '2026-06-14T00:00:00.000Z', // 1 day before NOW
      }),
    ];
    const [result] = attachNextActions(apps, events, NOW);
    expect(result!.nextAction.type).toBe('NO_ACTION');
    expect(result!.nextAction.followUpAnchorAt).toBe('2026-06-14T00:00:00.000Z');
  });

  // G. A manual, authoritative (source=USER, non-reverted) APPLICATION_RECEIVED transition
  // counts exactly the same way — the user is explicitly recording real progress.
  it('G: a manual (source=USER) non-reverted APPLICATION_RECEIVED transition also resets the follow-up anchor', () => {
    const apps = [
      application({
        id: 'app-1',
        status: 'APPLICATION_RECEIVED',
        appliedAt: '2026-06-05T00:00:00.000Z',
      }),
    ];
    const events = [
      event({
        applicationId: 'app-1',
        source: 'USER',
        toStatus: 'APPLICATION_RECEIVED',
        createdAt: '2026-06-14T00:00:00.000Z',
      }),
    ];
    const [result] = attachNextActions(apps, events, NOW);
    expect(result!.nextAction.type).toBe('NO_ACTION');
    expect(result!.nextAction.followUpAnchorAt).toBe('2026-06-14T00:00:00.000Z');
  });

  it('an application with no matching relevant status-change event falls back to appliedAt alone', () => {
    const apps = [
      application({
        id: 'app-1',
        status: 'APPLIED',
        appliedAt: '2026-06-05T00:00:00.000Z',
      }),
    ];
    const events = [event({ applicationId: 'some-other-app' })];
    const [result] = attachNextActions(apps, events, NOW);
    expect(result!.nextAction.followUpAnchorAt).toBe('2026-06-05T00:00:00.000Z');
  });
});

describe('buildLastRelevantStatusActivityMap', () => {
  it('keeps only the most recent event per application when the input is ordered newest-first', () => {
    const events = [
      event({ applicationId: 'app-1', createdAt: '2026-06-10T00:00:00.000Z' }),
      event({ applicationId: 'app-1', createdAt: '2026-06-01T00:00:00.000Z' }),
      event({ applicationId: 'app-2', createdAt: '2026-06-05T00:00:00.000Z' }),
    ];
    const map = buildLastRelevantStatusActivityMap(events);
    expect(map.get('app-1')).toBe('2026-06-10T00:00:00.000Z');
    expect(map.get('app-2')).toBe('2026-06-05T00:00:00.000Z');
  });

  // B. A reverted STATUS_CHANGE event does NOT reset the anchor — even though it may be the
  // chronologically most recent event, `reverted_at` being set means it no longer represents
  // current history.
  it('B: a reverted event (reverted_at set) is excluded even when it is the most recent by createdAt', () => {
    const events = [
      event({
        applicationId: 'app-1',
        createdAt: '2026-06-14T00:00:00.000Z', // most recent by time
        revertedAt: '2026-06-14T00:00:01.000Z', // but reverted a moment later
      }),
      event({
        applicationId: 'app-1',
        createdAt: '2026-06-01T00:00:00.000Z',
        revertedAt: null,
      }),
    ];
    const map = buildLastRelevantStatusActivityMap(events);
    expect(map.get('app-1')).toBe('2026-06-01T00:00:00.000Z');
  });

  // The exact Sep 1 / Sep 11 scenario from the task: applied Sep 1, an accidental status change,
  // reverted back to APPLIED on Sep 11 (which logs its own SYSTEM-sourced event on Sep 11). The
  // SYSTEM event must not become the anchor.
  it('excludes the SYSTEM-sourced event revertApplicationEvent itself creates to log a revert', () => {
    const events = [
      // The revert's own bookkeeping event — newest by createdAt, but source=SYSTEM.
      event({
        applicationId: 'app-1',
        source: 'SYSTEM',
        fromStatus: 'INTERVIEW',
        toStatus: 'APPLIED',
        createdAt: '2026-06-14T00:00:00.000Z', // Sep 11-equivalent: 1 day before NOW
        revertedAt: null,
      }),
      // The original (now-reverted) accidental change.
      event({
        applicationId: 'app-1',
        source: 'USER',
        fromStatus: 'APPLIED',
        toStatus: 'INTERVIEW',
        createdAt: '2026-06-10T00:00:00.000Z',
        revertedAt: '2026-06-14T00:00:00.000Z',
      }),
      // The original mark-applied transition.
      event({
        applicationId: 'app-1',
        source: 'USER',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'APPLIED',
        createdAt: '2026-06-05T00:00:00.000Z', // Sep 1-equivalent: 10 days before NOW
        revertedAt: null,
      }),
    ];
    const map = buildLastRelevantStatusActivityMap(events);
    // Neither the SYSTEM revert-logging event nor the reverted event count — the map falls
    // through to the original, still-legitimate mark-applied event.
    expect(map.get('app-1')).toBe('2026-06-05T00:00:00.000Z');
  });

  // D. A user edit unrelated to status (e.g. notes) never creates a STATUS_CHANGE event at all
  // (updateOwnApplication never calls recordApplicationEvent) — defensively asserted here too,
  // even though the real query already filters to event_type=STATUS_CHANGE server-side.
  it('D: a non-STATUS_CHANGE event (e.g. a NOTE, standing in for an unrelated user edit) has no effect', () => {
    const map = buildLastRelevantStatusActivityMap([
      event({
        applicationId: 'app-1',
        eventType: 'NOTE',
        createdAt: '2026-06-14T00:00:00.000Z',
      }),
    ]);
    expect(map.has('app-1')).toBe(false);
  });

  // E. An unconfirmed/ambiguous Gmail signal never creates any application_events row at all
  // (only confirmOwnEmailSignal's CONFIRM branch and the sync pipeline's AUTO_APPLIED case ever
  // call changeOwnApplicationStatus) — so it structurally cannot appear in this function's input
  // to begin with; an empty events array is exactly what that produces, and it must have no
  // effect (the anchor map stays empty, and the caller falls back to appliedAt alone).
  it('E: no events at all (as an unconfirmed Gmail signal produces) has no effect — empty map', () => {
    expect(buildLastRelevantStatusActivityMap([]).size).toBe(0);
  });

  it('returns an empty map for an empty input, never throwing', () => {
    expect(buildLastRelevantStatusActivityMap([]).size).toBe(0);
  });
});

describe('the Sep 1 / Sep 11 revert scenario end to end (deriveNextAction + assembly together)', () => {
  // A/C combined: applied Sep 1 (10 days ago), an accidental change reverted back to APPLIED on
  // Sep 11 (1 day ago) — the reverted event and its SYSTEM-sourced revert-logging event must
  // both be excluded, so the follow-up anchor falls back to the original, still-old appliedAt,
  // and a follow-up suggestion remains eligible rather than being incorrectly suppressed for
  // another 7 days.
  it('C: old appliedAt + a reverted recent event -> follow-up remains eligible based on the last legitimate anchor', () => {
    const apps = [
      application({
        id: 'app-1',
        status: 'APPLIED',
        appliedAt: '2026-06-05T00:00:00.000Z',
      }),
    ];
    const events = [
      event({
        applicationId: 'app-1',
        source: 'SYSTEM',
        toStatus: 'APPLIED',
        createdAt: '2026-06-14T00:00:00.000Z',
        revertedAt: null,
      }),
      event({
        applicationId: 'app-1',
        source: 'USER',
        toStatus: 'INTERVIEW',
        createdAt: '2026-06-10T00:00:00.000Z',
        revertedAt: '2026-06-14T00:00:00.000Z',
      }),
    ];
    const [result] = attachNextActions(apps, events, NOW);
    expect(result!.nextAction.type).toBe('CONSIDER_FOLLOW_UP');
    expect(result!.nextAction.followUpAnchorAt).toBe('2026-06-05T00:00:00.000Z');
  });
});

describe('sortApplicationsByAttention', () => {
  it('sorts URGENT before NONE', () => {
    const items = attachNextActions(
      [
        application({ id: 'rejected', status: 'REJECTED' }),
        application({ id: 'action-required', status: 'ACTION_REQUIRED' }),
      ],
      [],
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
      [],
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
        [],
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
