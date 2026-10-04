import { describe, expect, it } from 'vitest';
import {
  extractApplicationIdentity,
  extractCompanyName,
  extractJobTitle,
  UNDETECTED_TITLE_PLACEHOLDER,
} from './extract-application-identity';

describe('extractCompanyName', () => {
  it('extracts the display name from a "Name <email>" sender', () => {
    expect(extractCompanyName({ sender: 'Acme Careers <careers@acme.com>' })).toBe('Acme');
  });

  it('strips a quoted display name', () => {
    expect(extractCompanyName({ sender: '"Acme Talent Acquisition Team" <talent@acme.com>' })).toBe(
      'Acme',
    );
  });

  it('refuses a bare email address with no display name', () => {
    expect(extractCompanyName({ sender: 'careers@acme.com' })).toBeNull();
  });

  it('refuses a null sender', () => {
    expect(extractCompanyName({ sender: null })).toBeNull();
  });

  it('refuses when stripping role words leaves nothing', () => {
    expect(extractCompanyName({ sender: 'Careers <noreply@example.com>' })).toBeNull();
  });

  it('does not strip a real company name just because it contains a role-adjacent substring, when a non-role word remains', () => {
    expect(extractCompanyName({ sender: 'Globex Hiring <hiring@globex.com>' })).toBe('Globex');
  });
});

describe('extractJobTitle', () => {
  it('extracts from "application for X" phrasing', () => {
    expect(extractJobTitle('Your application for Backend Engineer')).toBe('Backend Engineer');
  });

  it('extracts from "application for the X position" phrasing', () => {
    expect(extractJobTitle('Application for the Backend Engineer position')).toBe(
      'Backend Engineer',
    );
  });

  it('extracts from "Re: X application" phrasing', () => {
    expect(extractJobTitle('Re: Backend Engineer application')).toBe('Backend Engineer');
  });

  it('returns null for a subject matching no known pattern', () => {
    expect(extractJobTitle('Thanks for reaching out!')).toBeNull();
  });

  it('returns null for a null subject', () => {
    expect(extractJobTitle(null)).toBeNull();
  });

  it('returns null for an implausibly long capture rather than a garbled title', () => {
    expect(extractJobTitle(`Your application for ${'x'.repeat(200)}`)).toBeNull();
  });
});

describe('extractApplicationIdentity', () => {
  it('combines a confidently-extracted company and title', () => {
    const result = extractApplicationIdentity({
      sender: 'Acme Careers <careers@acme.com>',
      subject: 'Your application for Backend Engineer',
    });
    expect(result).toEqual({ company: 'Acme', title: 'Backend Engineer' });
  });

  it('falls back to the undetected-title placeholder when only the title is unavailable', () => {
    const result = extractApplicationIdentity({
      sender: 'Acme Careers <careers@acme.com>',
      subject: 'Thanks for reaching out!',
    });
    expect(result).toEqual({ company: 'Acme', title: UNDETECTED_TITLE_PLACEHOLDER });
  });

  it('refuses entirely (null) when no company can be extracted, even with a clear title', () => {
    const result = extractApplicationIdentity({
      sender: 'careers@acme.com',
      subject: 'Your application for Backend Engineer',
    });
    expect(result).toBeNull();
  });
});
