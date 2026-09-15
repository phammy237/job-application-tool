import { describe, expect, it } from 'vitest';
import { normalizeJobTitle } from './normalize-job-title';

describe('normalizeJobTitle', () => {
  it('collapses surrounding/internal whitespace', () => {
    expect(normalizeJobTitle(' Product Manager Intern ')).toBe(
      normalizeJobTitle('Product Manager Intern'),
    );
    expect(normalizeJobTitle('Product   Manager    Intern')).toBe(
      normalizeJobTitle('Product Manager Intern'),
    );
  });

  it('is case-insensitive for comparison', () => {
    expect(normalizeJobTitle('Software Engineer')).toBe(normalizeJobTitle('SOFTWARE ENGINEER'));
  });

  it('normalizes punctuation spacing consistently', () => {
    expect(normalizeJobTitle('Engineer,Backend')).toBe(normalizeJobTitle('Engineer, Backend'));
    expect(normalizeJobTitle('Full-Time')).toBe(normalizeJobTitle('Full - Time'));
  });

  it('does not rewrite semantic meaning', () => {
    expect(normalizeJobTitle('Sr. Software Engineer')).not.toBe(
      normalizeJobTitle('Senior Software Engineer'),
    );
  });

  it('is deterministic', () => {
    const title = 'Backend Engineer, Payments';
    expect(normalizeJobTitle(title)).toBe(normalizeJobTitle(title));
  });
});
