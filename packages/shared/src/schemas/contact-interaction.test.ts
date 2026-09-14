import { describe, expect, it } from 'vitest';
import {
  contactInteractionSchema,
  contactInteractionTypeSchema,
  createContactInteractionInputSchema,
  interactionDirectionSchema,
  updateContactInteractionInputSchema,
} from './contact-interaction';

const VALID_INTERACTION = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  contactId: '33333333-3333-4333-8333-333333333333',
  interactionType: 'EMAIL',
  direction: null,
  occurredAt: '2026-01-01T00:00:00.000Z',
  subject: null,
  notes: null,
  applicationId: null,
  source: 'MANUAL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('contactInteractionTypeSchema', () => {
  it('accepts every Phase 6B-supported interaction type', () => {
    for (const type of [
      'EMAIL',
      'CALL',
      'COFFEE_CHAT',
      'MEETING',
      'LINKEDIN_MESSAGE',
      'EVENT',
      'INTRODUCTION',
      'NOTE',
      'OTHER',
    ]) {
      expect(contactInteractionTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('rejects a purpose-shaped value, not a medium', () => {
    expect(contactInteractionTypeSchema.safeParse('THANK_YOU').success).toBe(false);
    expect(contactInteractionTypeSchema.safeParse('FOLLOW_UP').success).toBe(false);
    expect(contactInteractionTypeSchema.safeParse('REFERRAL_REQUEST').success).toBe(
      false,
    );
  });
});

describe('interactionDirectionSchema', () => {
  it('accepts INBOUND, OUTBOUND, and MUTUAL', () => {
    for (const d of ['INBOUND', 'OUTBOUND', 'MUTUAL']) {
      expect(interactionDirectionSchema.safeParse(d).success).toBe(true);
    }
  });

  it('rejects an unsupported value', () => {
    expect(interactionDirectionSchema.safeParse('SIDEWAYS').success).toBe(false);
  });
});

describe('contactInteractionSchema', () => {
  it('accepts a minimal interaction — only type and occurredAt truly matter', () => {
    expect(contactInteractionSchema.safeParse(VALID_INTERACTION).success).toBe(true);
  });

  it('accepts a fully-populated interaction', () => {
    const result = contactInteractionSchema.safeParse({
      ...VALID_INTERACTION,
      direction: 'OUTBOUND',
      subject: 'Coffee chat follow-up',
      notes: 'Discussed the PM internship at Acme.',
      applicationId: '44444444-4444-4444-8444-444444444444',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown source', () => {
    expect(
      contactInteractionSchema.safeParse({ ...VALID_INTERACTION, source: 'GMAIL_SIGNAL' })
        .success,
    ).toBe(false);
  });
});

describe('createContactInteractionInputSchema', () => {
  it('requires interactionType and occurredAt only', () => {
    const parsed = createContactInteractionInputSchema.parse({
      interactionType: 'COFFEE_CHAT',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.interactionType).toBe('COFFEE_CHAT');
    expect(parsed.direction).toBeUndefined();
    expect(parsed.subject).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('rejects a missing interactionType', () => {
    expect(
      createContactInteractionInputSchema.safeParse({
        occurredAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing occurredAt', () => {
    expect(
      createContactInteractionInputSchema.safeParse({ interactionType: 'EMAIL' }).success,
    ).toBe(false);
  });

  it('rejects a malformed occurredAt (not a real ISO datetime)', () => {
    expect(
      createContactInteractionInputSchema.safeParse({
        interactionType: 'EMAIL',
        occurredAt: '2026-01-01',
      }).success,
    ).toBe(false);
  });

  it('normalizes an empty-string subject/notes to null', () => {
    const parsed = createContactInteractionInputSchema.parse({
      interactionType: 'EMAIL',
      occurredAt: '2026-01-01T00:00:00.000Z',
      subject: '',
      notes: '',
    });
    expect(parsed.subject).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('trims whitespace-padded subject/notes', () => {
    const parsed = createContactInteractionInputSchema.parse({
      interactionType: 'EMAIL',
      occurredAt: '2026-01-01T00:00:00.000Z',
      subject: '  Following up  ',
    });
    expect(parsed.subject).toBe('Following up');
  });

  it('does not have a source field — Phase 6B only ever creates MANUAL interactions', () => {
    const parsed = createContactInteractionInputSchema.parse({
      interactionType: 'EMAIL',
      occurredAt: '2026-01-01T00:00:00.000Z',
      source: 'GMAIL_SIGNAL',
    } as never);
    expect(parsed).not.toHaveProperty('source');
  });

  it('rejects an excessively long subject', () => {
    expect(
      createContactInteractionInputSchema.safeParse({
        interactionType: 'EMAIL',
        occurredAt: '2026-01-01T00:00:00.000Z',
        subject: 'a'.repeat(500),
      }).success,
    ).toBe(false);
  });

  it('accepts an optional applicationId', () => {
    const parsed = createContactInteractionInputSchema.parse({
      interactionType: 'MEETING',
      occurredAt: '2026-01-01T00:00:00.000Z',
      applicationId: '44444444-4444-4444-8444-444444444444',
    });
    expect(parsed.applicationId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('rejects a malformed applicationId', () => {
    expect(
      createContactInteractionInputSchema.safeParse({
        interactionType: 'MEETING',
        occurredAt: '2026-01-01T00:00:00.000Z',
        applicationId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

describe('updateContactInteractionInputSchema', () => {
  it('accepts a partial update with everything omitted', () => {
    expect(updateContactInteractionInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts updating just the subject', () => {
    const parsed = updateContactInteractionInputSchema.parse({
      subject: 'Updated subject',
    });
    expect(parsed.subject).toBe('Updated subject');
    expect(parsed.interactionType).toBeUndefined();
  });
});
