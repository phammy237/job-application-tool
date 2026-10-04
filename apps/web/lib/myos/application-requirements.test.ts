import { describe, expect, it } from 'vitest';
import { resolveApplicationRequirements } from './application-requirements';

const snap = {
  description:
    'Requirements:\n- 3 years of experience with React\n- Strong SQL knowledge',
  requiredQualifications: [],
  preferredQualifications: [],
};

describe('resolveApplicationRequirements', () => {
  it('prefers the current mapping run', () => {
    const r = resolveApplicationRequirements({
      mappings: [{ requirementText: 'Know React', requiredOrPreferred: 'PREFERRED' }],
      snapshot: snap,
    });
    expect(r.source).toBe('ANALYSIS_RUN');
    expect(r.requirements).toEqual([
      { id: 'req-1', text: 'Know React', category: 'PREFERRED' },
    ]);
  });

  it('uses snapshot lists when there is no run, dedupes, and keeps categories', () => {
    const r = resolveApplicationRequirements({
      mappings: [],
      snapshot: {
        ...snap,
        requiredQualifications: ['Python', 'python', 'SQL'],
        preferredQualifications: ['Docker'],
      },
    });
    expect(r.source).toBe('POSTING_LISTS');
    expect(r.requirements.map((x) => [x.text, x.category])).toEqual([
      ['Python', 'REQUIRED'],
      ['SQL', 'REQUIRED'],
      ['Docker', 'PREFERRED'],
    ]);
  });

  it('falls back to deterministic extraction from the description', () => {
    const r = resolveApplicationRequirements({ mappings: null, snapshot: snap });
    expect(r.source).toBe('EXTRACTED_FROM_TEXT');
    expect(r.requirements.length).toBeGreaterThan(0);
  });

  it('returns NONE with nothing to work from', () => {
    expect(resolveApplicationRequirements({ mappings: null, snapshot: null })).toEqual({
      source: 'NONE',
      requirements: [],
    });
  });
});
