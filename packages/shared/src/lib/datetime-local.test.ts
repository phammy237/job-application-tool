import { describe, expect, it } from 'vitest';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from './datetime-local';

// Every expected value below is derived from a Date constructed with the *local* constructor
// (`new Date(year, monthIndex, day, hours, minutes)`), never a hardcoded UTC offset — so these
// tests pass in any timezone the runner happens to be in, exactly like the real browser usage
// this module supports.

describe('toDatetimeLocalValue', () => {
  it('formats a local date/time as YYYY-MM-DDTHH:mm', () => {
    const local = new Date(2026, 0, 15, 9, 5); // Jan 15 2026, 09:05 local
    expect(toDatetimeLocalValue(local.toISOString())).toBe('2026-01-15T09:05');
  });

  it('zero-pads single-digit month, day, hour, and minute', () => {
    const local = new Date(2026, 0, 5, 3, 7); // Jan 5 2026, 03:07 local
    expect(toDatetimeLocalValue(local.toISOString())).toBe('2026-01-05T03:07');
  });

  it('handles end-of-year date/time correctly', () => {
    const local = new Date(2026, 11, 31, 23, 59); // Dec 31 2026, 23:59 local
    expect(toDatetimeLocalValue(local.toISOString())).toBe('2026-12-31T23:59');
  });

  it('handles midnight correctly', () => {
    const local = new Date(2026, 5, 1, 0, 0); // Jun 1 2026, 00:00 local
    expect(toDatetimeLocalValue(local.toISOString())).toBe('2026-06-01T00:00');
  });
});

describe('fromDatetimeLocalValue', () => {
  it('parses a datetime-local value as local time, matching the local Date constructor', () => {
    const expected = new Date(2026, 0, 15, 9, 5).toISOString();
    expect(fromDatetimeLocalValue('2026-01-15T09:05')).toBe(expected);
  });

  it('parses single-digit-padded components the same way', () => {
    const expected = new Date(2026, 0, 5, 3, 7).toISOString();
    expect(fromDatetimeLocalValue('2026-01-05T03:07')).toBe(expected);
  });
});

describe('round-trip', () => {
  it('toDatetimeLocalValue(fromDatetimeLocalValue(v)) === v', () => {
    const value = '2026-03-22T14:30';
    expect(toDatetimeLocalValue(fromDatetimeLocalValue(value))).toBe(value);
  });

  it('fromDatetimeLocalValue(toDatetimeLocalValue(iso)) preserves the same instant', () => {
    const iso = new Date(2026, 6, 4, 18, 45).toISOString();
    expect(fromDatetimeLocalValue(toDatetimeLocalValue(iso))).toBe(iso);
  });
});
