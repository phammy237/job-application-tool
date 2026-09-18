import { describe, expect, it } from 'vitest';
import { formatFriendlyDate, formatFriendlyDateTime } from './format-friendly-date';

describe('formatFriendlyDateTime', () => {
  it('formats as "Mon D, YYYY · H:MM AM/PM" — never the raw numeric locale string', () => {
    const result = formatFriendlyDateTime('2026-08-10T08:56:18.000Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026 · \d{1,2}:\d{2} (AM|PM)$/);
    expect(result).not.toContain('/');
    expect(result).not.toMatch(/:\d{2}:\d{2}/); // never seconds
  });
});

describe('formatFriendlyDate', () => {
  it('formats as "Mon D, YYYY" with no time component', () => {
    const result = formatFriendlyDate('2026-08-10T08:56:18.000Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026$/);
  });
});
