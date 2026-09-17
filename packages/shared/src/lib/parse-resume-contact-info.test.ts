import { describe, expect, it } from 'vitest';
import { parseResumeContactInfo } from './parse-resume-contact-info';

const SAMPLE_RESUME = `Jane Doe
jane.doe@example.com | (555) 123-4567 | https://linkedin.com/in/janedoe | https://github.com/janedoe

EXPERIENCE
Software Engineer, Acme Corp
...`;

describe('parseResumeContactInfo', () => {
  it('extracts email via regex, never fabricated', () => {
    expect(parseResumeContactInfo(SAMPLE_RESUME).email).toBe('jane.doe@example.com');
  });

  it('extracts a phone number', () => {
    expect(parseResumeContactInfo(SAMPLE_RESUME).phone).toContain('555');
  });

  it('extracts LinkedIn and GitHub URLs distinctly', () => {
    const result = parseResumeContactInfo(SAMPLE_RESUME);
    expect(result.linkedin).toBe('https://linkedin.com/in/janedoe');
    expect(result.github).toBe('https://github.com/janedoe');
  });

  it('uses the first non-empty line as the name candidate', () => {
    expect(parseResumeContactInfo(SAMPLE_RESUME).fullName).toBe('Jane Doe');
  });

  it('never treats an email/phone/URL line as the candidate name', () => {
    const noNameLine = `jane.doe@example.com\nSoftware Engineer`;
    // First line IS the email — must be skipped, never returned as fullName.
    expect(parseResumeContactInfo(noNameLine).fullName).not.toBe('jane.doe@example.com');
  });

  it('returns null for every field with no match, never a guess', () => {
    const result = parseResumeContactInfo('Some unrelated text with nothing extractable in it');
    expect(result.email).toBeNull();
    expect(result.linkedin).toBeNull();
    expect(result.github).toBeNull();
    expect(result.location).toBeNull();
    expect(result.website).toBeNull();
  });

  it('never picks up linkedin/github URLs as the generic "portfolio" URL', () => {
    const result = parseResumeContactInfo(SAMPLE_RESUME);
    expect(result.portfolio).not.toBe(result.linkedin);
    expect(result.portfolio).not.toBe(result.github);
  });
});
