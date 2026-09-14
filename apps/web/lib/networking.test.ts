import { describe, expect, it } from 'vitest';
import type { Contact } from '@career-os/shared';
import { attachNetworkingNextActions, sortContactsByFollowUpDue } from './networking';

const NOW = '2026-06-15T12:00:00.000Z';

function makeContact(overrides: Partial<Contact>): Contact {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    displayName: 'Jane Doe',
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    linkedinUrl: null,
    currentCompany: null,
    currentTitle: null,
    location: null,
    notes: null,
    source: 'MANUAL',
    followUpAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('attachNetworkingNextActions', () => {
  it('derives NO_ACTION for a contact with no reminder', () => {
    const [result] = attachNetworkingNextActions([makeContact({})], NOW);
    expect(result?.nextAction.type).toBe('NO_ACTION');
  });

  it('derives FOLLOW_UP_WITH_CONTACT for a contact with a due reminder', () => {
    const [result] = attachNetworkingNextActions(
      [makeContact({ followUpAt: '2026-06-14T12:00:00.000Z' })],
      NOW,
    );
    expect(result?.nextAction.type).toBe('FOLLOW_UP_WITH_CONTACT');
  });

  it('preserves the original contact list order and length', () => {
    const contacts = [
      makeContact({ id: 'a', displayName: 'A' }),
      makeContact({ id: 'b', displayName: 'B' }),
    ];
    const result = attachNetworkingNextActions(contacts, NOW);
    expect(result.map((r) => r.contact.id)).toEqual(['a', 'b']);
  });
});

describe('sortContactsByFollowUpDue', () => {
  it('orders earliest follow_up_at first', () => {
    const items = attachNetworkingNextActions(
      [
        makeContact({ id: 'later', displayName: 'Later', followUpAt: '2026-06-01T00:00:00.000Z' }),
        makeContact({ id: 'earlier', displayName: 'Earlier', followUpAt: '2026-05-01T00:00:00.000Z' }),
      ],
      NOW,
    );
    const sorted = sortContactsByFollowUpDue(items);
    expect(sorted.map((s) => s.contact.id)).toEqual(['earlier', 'later']);
  });

  it('breaks ties by display name', () => {
    const sameDate = '2026-05-01T00:00:00.000Z';
    const items = attachNetworkingNextActions(
      [
        makeContact({ id: 'z', displayName: 'Zed', followUpAt: sameDate }),
        makeContact({ id: 'a', displayName: 'Alice', followUpAt: sameDate }),
      ],
      NOW,
    );
    const sorted = sortContactsByFollowUpDue(items);
    expect(sorted.map((s) => s.contact.displayName)).toEqual(['Alice', 'Zed']);
  });

  it('does not mutate the input array', () => {
    const items = attachNetworkingNextActions(
      [
        makeContact({ id: 'b', displayName: 'B', followUpAt: '2026-06-01T00:00:00.000Z' }),
        makeContact({ id: 'a', displayName: 'A', followUpAt: '2026-05-01T00:00:00.000Z' }),
      ],
      NOW,
    );
    const original = [...items];
    sortContactsByFollowUpDue(items);
    expect(items).toEqual(original);
  });
});
