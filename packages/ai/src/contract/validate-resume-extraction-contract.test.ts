import { describe, expect, it } from 'vitest';
import { validateResumeExtractionContract } from './validate-resume-extraction-contract';

const SOURCE_TEXT = `Jane Doe
jane@example.com

EXPERIENCE
Software Engineer, Acme Corp
May 2023 - Present
- Built a real-time dashboard for internal analytics
- Reduced API latency by refactoring the caching layer

EDUCATION
State University
B.S. Computer Science

SKILLS
TypeScript, React, PostgreSQL`;

function contractJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    experience: [],
    education: [],
    projects: [],
    skills: [],
    ...overrides,
  });
}

describe('validateResumeExtractionContract', () => {
  it('rejects malformed JSON', () => {
    const result = validateResumeExtractionContract('not json', SOURCE_TEXT);
    expect(result).toEqual({ status: 'rejected', reason: 'validation_failed' });
  });

  it('rejects a response that fails the schema shape', () => {
    // experience must be an array of objects — a bare string violates the shape outright.
    const result = validateResumeExtractionContract(
      JSON.stringify({ experience: 'not an array', education: [], projects: [], skills: [] }),
      SOURCE_TEXT,
    );
    expect(result.status).toBe('rejected');
  });

  it('accepts a fully grounded entry verbatim, with no drops', () => {
    const json = contractJson({
      experience: [
        {
          company: 'Acme Corp',
          title: 'Software Engineer',
          location: null,
          dateRangeText: 'May 2023 - Present',
          bullets: ['Built a real-time dashboard for internal analytics'],
          uncertain: false,
        },
      ],
    });
    const result = validateResumeExtractionContract(json, SOURCE_TEXT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.experience).toHaveLength(1);
    expect(result.droppedCount).toBe(0);
  });

  it('drops an entire experience entry when the company name is not grounded in the source text (fabrication)', () => {
    const json = contractJson({
      experience: [
        {
          company: 'A Company That Was Never In The Resume',
          title: 'Software Engineer',
          location: null,
          dateRangeText: null,
          bullets: [],
          uncertain: false,
        },
      ],
    });
    const result = validateResumeExtractionContract(json, SOURCE_TEXT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.experience).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  it('drops only the fabricated bullet, keeping an otherwise-grounded entry and its real bullets', () => {
    const json = contractJson({
      experience: [
        {
          company: 'Acme Corp',
          title: 'Software Engineer',
          location: null,
          dateRangeText: null,
          bullets: [
            'Built a real-time dashboard for internal analytics', // real
            'Increased revenue by 300% through strategic initiatives', // fabricated metric
          ],
          uncertain: false,
        },
      ],
    });
    const result = validateResumeExtractionContract(json, SOURCE_TEXT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.experience).toHaveLength(1);
    expect(result.result.experience[0]?.bullets).toEqual([
      'Built a real-time dashboard for internal analytics',
    ]);
    expect(result.droppedCount).toBe(1);
  });

  it('is whitespace/case-insensitive but still requires the real words to appear (PDF reflow tolerance)', () => {
    const json = contractJson({
      experience: [
        {
          company: 'acme corp', // different case
          title: 'SOFTWARE   ENGINEER', // different case + extra whitespace
          location: null,
          dateRangeText: null,
          bullets: [],
          uncertain: false,
        },
      ],
    });
    const result = validateResumeExtractionContract(json, SOURCE_TEXT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.experience).toHaveLength(1);
    expect(result.droppedCount).toBe(0);
  });

  it('drops an education entry whose school is not grounded', () => {
    const json = contractJson({
      education: [
        { school: 'A University Never Mentioned', degree: null, fieldOfStudy: null, dateRangeText: null, gpa: null, uncertain: false },
      ],
    });
    const result = validateResumeExtractionContract(json, SOURCE_TEXT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.education).toHaveLength(0);
  });

  it('drops a skill not literally named in the source text (never "probably used it")', () => {
    const json = contractJson({
      skills: [
        { name: 'TypeScript', category: null }, // real, in source
        { name: 'Kubernetes', category: null }, // never mentioned — must be dropped
      ],
    });
    const result = validateResumeExtractionContract(json, SOURCE_TEXT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.result.skills.map((s) => s.name)).toEqual(['TypeScript']);
    expect(result.droppedCount).toBe(1);
  });

  it('an empty bullet list/no sections at all produces zero drops, never fabricates to fill a section', () => {
    const result = validateResumeExtractionContract(contractJson(), SOURCE_TEXT);
    expect(result).toEqual({
      status: 'ok',
      result: { experience: [], education: [], projects: [], skills: [] },
      droppedCount: 0,
    });
  });
});
