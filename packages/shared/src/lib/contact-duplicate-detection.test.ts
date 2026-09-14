import { describe, expect, it } from 'vitest';
import type { Contact } from '../schemas/contact';
import {
  findPossibleDuplicateContacts,
  normalizeContactCompany,
  normalizeContactDisplayName,
  normalizeContactEmail,
  normalizeLinkedInUrl,
} from './contact-duplicate-detection';

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

describe('normalizeContactEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeContactEmail('  Jane@Example.com  ')).toBe('jane@example.com');
  });

  it('returns null for null/undefined/blank', () => {
    expect(normalizeContactEmail(null)).toBeNull();
    expect(normalizeContactEmail(undefined)).toBeNull();
    expect(normalizeContactEmail('   ')).toBeNull();
  });
});

describe('normalizeLinkedInUrl', () => {
  it('treats scheme, www, and trailing-slash differences as equivalent', () => {
    const a = normalizeLinkedInUrl('https://www.linkedin.com/in/janedoe/');
    const b = normalizeLinkedInUrl('http://linkedin.com/in/janedoe');
    expect(a).toBe(b);
  });

  it('ignores query string and fragment', () => {
    const a = normalizeLinkedInUrl('https://linkedin.com/in/janedoe?trk=abc#section');
    const b = normalizeLinkedInUrl('https://linkedin.com/in/janedoe');
    expect(a).toBe(b);
  });

  it('handles a bare domain pasted without a scheme', () => {
    expect(normalizeLinkedInUrl('linkedin.com/in/janedoe')).toBe(
      normalizeLinkedInUrl('https://linkedin.com/in/janedoe'),
    );
  });

  it('two different profile slugs normalize differently', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/janedoe')).not.toBe(
      normalizeLinkedInUrl('https://linkedin.com/in/johnsmith'),
    );
  });

  it('returns null for null/undefined/blank', () => {
    expect(normalizeLinkedInUrl(null)).toBeNull();
    expect(normalizeLinkedInUrl(undefined)).toBeNull();
    expect(normalizeLinkedInUrl('  ')).toBeNull();
  });

  it('never throws on genuinely unparseable input', () => {
    expect(() => normalizeLinkedInUrl('::::not a url at all::::')).not.toThrow();
  });
});

describe('normalizeContactDisplayName / normalizeContactCompany', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeContactDisplayName('  Jane   Doe  ')).toBe('jane doe');
  });

  it('strips a trailing legal-entity suffix from a company name', () => {
    expect(normalizeContactCompany('Acme, Inc.')).toBe('acme');
    expect(normalizeContactCompany('Acme LLC')).toBe('acme');
    expect(normalizeContactCompany('Acme Corp')).toBe('acme');
  });

  it('leaves an already-plain company name alone', () => {
    expect(normalizeContactCompany('Acme')).toBe('acme');
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeContactDisplayName(null)).toBe('');
    expect(normalizeContactCompany(undefined)).toBe('');
  });
});

describe('findPossibleDuplicateContacts', () => {
  it('flags an exact normalized email match', () => {
    const existing = [makeContact({ email: 'Jane@Example.com' })];
    const result = findPossibleDuplicateContacts(
      { displayName: 'Someone Else', email: 'jane@example.com', linkedinUrl: null, currentCompany: null },
      existing,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe('EMAIL_MATCH');
  });

  it('flags an exact normalized LinkedIn URL match', () => {
    const existing = [makeContact({ linkedinUrl: 'https://www.linkedin.com/in/janedoe/' })];
    const result = findPossibleDuplicateContacts(
      {
        displayName: 'Someone Else',
        email: null,
        linkedinUrl: 'linkedin.com/in/janedoe',
        currentCompany: null,
      },
      existing,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe('LINKEDIN_MATCH');
  });

  it('flags a normalized display_name + company match', () => {
    const existing = [makeContact({ displayName: 'Jane Doe', currentCompany: 'Acme Inc.' })];
    const result = findPossibleDuplicateContacts(
      { displayName: 'jane doe', email: null, linkedinUrl: null, currentCompany: 'Acme' },
      existing,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe('NAME_COMPANY_MATCH');
  });

  it('does not flag a name match alone without a company on both sides', () => {
    const existing = [makeContact({ displayName: 'Jane Doe', currentCompany: null })];
    const result = findPossibleDuplicateContacts(
      { displayName: 'Jane Doe', email: null, linkedinUrl: null, currentCompany: null },
      existing,
    );
    expect(result).toHaveLength(0);
  });

  it('prioritizes EMAIL_MATCH over a weaker signal on the same contact', () => {
    const existing = [
      makeContact({
        email: 'jane@example.com',
        displayName: 'Jane Doe',
        currentCompany: 'Acme',
      }),
    ];
    const result = findPossibleDuplicateContacts(
      {
        displayName: 'Jane Doe',
        email: 'jane@example.com',
        linkedinUrl: null,
        currentCompany: 'Acme',
      },
      existing,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe('EMAIL_MATCH');
  });

  it('excludes the given contact id — editing a contact does not duplicate itself', () => {
    const existing = [
      makeContact({ id: 'self-0000-4000-8000-000000000000', email: 'jane@example.com' }),
    ];
    const result = findPossibleDuplicateContacts(
      { displayName: 'Jane', email: 'jane@example.com', linkedinUrl: null, currentCompany: null },
      existing,
      'self-0000-4000-8000-000000000000',
    );
    expect(result).toHaveLength(0);
  });

  it('returns no results when nothing matches', () => {
    const existing = [makeContact({ email: 'bob@example.com' })];
    const result = findPossibleDuplicateContacts(
      { displayName: 'Someone New', email: 'jane@example.com', linkedinUrl: null, currentCompany: null },
      existing,
    );
    expect(result).toHaveLength(0);
  });
});
