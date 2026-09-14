import { describe, expect, it } from 'vitest';
import {
  buildResumeFileName,
  buildTailoredResumeDisplayName,
  sanitizeResumeFileNameSegment,
} from './resume-naming';

describe('buildTailoredResumeDisplayName', () => {
  it("uses the owner's full name when set", () => {
    expect(buildTailoredResumeDisplayName('Ada Lovelace', 'Microsoft', 'PM Intern')).toBe(
      "Ada Lovelace's Resume -- Microsoft -- PM Intern",
    );
  });

  it('falls back to a generic, non-identifying label when the owner has no full name set', () => {
    expect(buildTailoredResumeDisplayName(null, 'Google', 'SWE Intern')).toBe(
      'My Resume -- Google -- SWE Intern',
    );
    expect(buildTailoredResumeDisplayName('   ', 'Google', 'SWE Intern')).toBe(
      'My Resume -- Google -- SWE Intern',
    );
  });

  it('never bakes in a literal hardcoded person name (CLAUDE.md multi-tenancy)', () => {
    const result = buildTailoredResumeDisplayName(null, 'Acme', 'Analyst');
    expect(result).not.toContain('My Pham');
  });
});

describe('sanitizeResumeFileNameSegment', () => {
  it('strips illegal filename characters', () => {
    expect(sanitizeResumeFileNameSegment('A/B\\C:D*E?F"G<H>I|J')).toBe('ABCDEFGHIJ');
  });

  it('strips control characters', () => {
    expect(sanitizeResumeFileNameSegment('Resume\x00\x1f')).toBe('Resume');
  });

  it('preserves ordinary punctuation', () => {
    expect(sanitizeResumeFileNameSegment("Ada's Resume -- R&D, Inc.")).toBe(
      "Ada's Resume -- R&D, Inc.",
    );
  });
});

describe('buildResumeFileName', () => {
  it('appends the default pdf extension to a sanitized display name', () => {
    expect(buildResumeFileName('My Resume -- Microsoft -- PM Intern')).toBe(
      'My Resume -- Microsoft -- PM Intern.pdf',
    );
  });

  it('sanitizes before appending the extension', () => {
    expect(buildResumeFileName('Resume: Q4/2026')).toBe('Resume Q42026.pdf');
  });

  it('accepts a custom extension', () => {
    expect(buildResumeFileName('Resume', 'docx')).toBe('Resume.docx');
  });
});
