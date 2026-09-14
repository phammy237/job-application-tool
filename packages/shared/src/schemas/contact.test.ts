import { describe, expect, it } from 'vitest';
import {
  applicationContactRoleSchema,
  contactSchema,
  contactSourceSchema,
  contactTagSchema,
  createContactInputSchema,
  setContactFollowUpInputSchema,
  updateContactInputSchema,
} from './contact';

const VALID_CONTACT = {
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
};

describe('contactSourceSchema', () => {
  it('accepts every Phase 6A-supported source', () => {
    for (const source of ['MANUAL', 'APPLICATION_CONTEXT', 'OTHER']) {
      expect(contactSourceSchema.safeParse(source).success).toBe(true);
    }
  });

  it('rejects a speculative future source not yet shipped', () => {
    expect(contactSourceSchema.safeParse('EMAIL_SUGGESTION').success).toBe(false);
    expect(contactSourceSchema.safeParse('IMPORT').success).toBe(false);
  });
});

describe('contactTagSchema / applicationContactRoleSchema', () => {
  it('are distinct taxonomies', () => {
    expect(contactTagSchema.safeParse('INTERVIEWER').success).toBe(false);
    expect(applicationContactRoleSchema.safeParse('ALUMNI').success).toBe(false);
  });

  it('REFERRER exists on both — the person can be tagged and hold that application role', () => {
    expect(contactTagSchema.safeParse('REFERRER').success).toBe(true);
    expect(applicationContactRoleSchema.safeParse('REFERRER').success).toBe(true);
  });
});

describe('contactSchema', () => {
  it('accepts a minimal contact — only displayName/source required beyond identity fields', () => {
    expect(contactSchema.safeParse(VALID_CONTACT).success).toBe(true);
  });

  it('rejects an empty displayName', () => {
    const result = contactSchema.safeParse({ ...VALID_CONTACT, displayName: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a real followUpAt timestamp', () => {
    const result = contactSchema.safeParse({
      ...VALID_CONTACT,
      followUpAt: '2026-06-14T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('requires the followUpAt key to be present (even if null) — no reminder is an explicit null, not an absent field', () => {
    const { followUpAt: _followUpAt, ...withoutFollowUpAt } = VALID_CONTACT;
    const result = contactSchema.safeParse(withoutFollowUpAt);
    expect(result.success).toBe(false);
  });
});

describe('setContactFollowUpInputSchema', () => {
  it('requires a real ISO datetime', () => {
    expect(
      setContactFollowUpInputSchema.safeParse({ followUpAt: '2026-06-14T12:00:00.000Z' })
        .success,
    ).toBe(true);
  });

  it('rejects a missing followUpAt', () => {
    expect(setContactFollowUpInputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a date-only string without a time component', () => {
    expect(setContactFollowUpInputSchema.safeParse({ followUpAt: '2026-06-14' }).success).toBe(
      false,
    );
  });

  it('rejects a malformed timestamp', () => {
    expect(
      setContactFollowUpInputSchema.safeParse({ followUpAt: 'not-a-date' }).success,
    ).toBe(false);
  });
});

describe('createContactInputSchema', () => {
  it('requires only displayName — "Jane — UF alum at Microsoft" style minimal contact', () => {
    const parsed = createContactInputSchema.parse({ displayName: 'Jane — UF alum at Microsoft' });
    expect(parsed.displayName).toBe('Jane — UF alum at Microsoft');
    expect(parsed.email).toBeNull();
    expect(parsed.source).toBe('MANUAL');
    expect(parsed.tags).toEqual([]);
  });

  it('rejects a blank displayName', () => {
    expect(createContactInputSchema.safeParse({ displayName: '   ' }).success).toBe(false);
  });

  it('rejects a malformed email rather than silently dropping it', () => {
    expect(
      createContactInputSchema.safeParse({ displayName: 'Jane', email: 'not-an-email' }).success,
    ).toBe(false);
  });

  it('normalizes an empty-string email to null', () => {
    const parsed = createContactInputSchema.parse({ displayName: 'Jane', email: '' });
    expect(parsed.email).toBeNull();
  });

  it('accepts a valid email and a set of tags', () => {
    const parsed = createContactInputSchema.parse({
      displayName: 'Jane Doe',
      email: 'jane@example.com',
      tags: ['RECRUITER', 'ALUMNI'],
    });
    expect(parsed.email).toBe('jane@example.com');
    expect(parsed.tags).toEqual(['RECRUITER', 'ALUMNI']);
  });

  it('rejects an unknown tag', () => {
    expect(
      createContactInputSchema.safeParse({ displayName: 'Jane', tags: ['NOT_A_TAG'] }).success,
    ).toBe(false);
  });

  it('rejects an excessively long display name', () => {
    expect(
      createContactInputSchema.safeParse({ displayName: 'a'.repeat(500) }).success,
    ).toBe(false);
  });

  it('trims whitespace-padded optional fields', () => {
    const parsed = createContactInputSchema.parse({
      displayName: '  Jane  ',
      currentCompany: '  Acme  ',
    });
    expect(parsed.displayName).toBe('Jane');
    expect(parsed.currentCompany).toBe('Acme');
  });
});

describe('updateContactInputSchema', () => {
  it('accepts a partial update with everything omitted', () => {
    expect(updateContactInputSchema.safeParse({}).success).toBe(true);
  });

  it('does not accept a source field — a contact origin never changes after creation', () => {
    const parsed = updateContactInputSchema.parse({ displayName: 'Jane', source: 'OTHER' } as never);
    expect(parsed).not.toHaveProperty('source');
  });
});
