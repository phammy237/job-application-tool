import { describe, expect, it } from 'vitest';
import {
  createEmptyStructuredResume,
  createResumeEntryId,
  resumeBulletProvenanceSchema,
  resumeDateRangeSchema,
  structuredResumeV1Schema,
} from './resume-content';

const HEADER = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  location: null,
  links: {},
};

describe('structuredResumeV1Schema', () => {
  it('accepts a minimal (header-only) resume', () => {
    const resume = createEmptyStructuredResume(HEADER);
    expect(() => structuredResumeV1Schema.parse(resume)).not.toThrow();
  });

  it('accepts a fully populated resume', () => {
    const resume = {
      schemaVersion: 1,
      header: HEADER,
      education: [
        {
          id: 'e1',
          institution: 'MIT',
          degree: 'B.S.',
          fieldOfStudy: 'CS',
          location: null,
          dateRange: { start: null, end: null, isPresent: false },
          gpa: '3.9',
          honors: ["Dean's List"],
          bullets: [],
        },
      ],
      experience: [
        {
          id: 'x1',
          organization: 'Acme',
          role: 'Engineer',
          location: null,
          dateRange: { start: { year: 2024, month: 1 }, end: null, isPresent: true },
          bullets: [{ id: 'b1', text: 'Did a thing.', provenance: { type: 'MANUAL' } }],
        },
      ],
      projects: [],
      leadership: [],
      skills: [{ id: 's1', label: 'Languages', items: ['Python'] }],
      renderOverride: null,
    };
    expect(() => structuredResumeV1Schema.parse(resume)).not.toThrow();
  });

  it('rejects a malformed schemaVersion', () => {
    const resume = { ...createEmptyStructuredResume(HEADER), schemaVersion: 2 };
    expect(() => structuredResumeV1Schema.parse(resume)).toThrow();
  });

  it('rejects a missing/empty required label (institution)', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      education: [
        {
          id: 'e1',
          institution: '',
          degree: null,
          fieldOfStudy: null,
          location: null,
          dateRange: { start: null, end: null, isPresent: false },
          gpa: null,
          honors: [],
          bullets: [],
        },
      ],
    };
    expect(() => structuredResumeV1Schema.parse(resume)).toThrow();
  });

  it('rejects a header with no fullName', () => {
    const resume = createEmptyStructuredResume({ ...HEADER, fullName: '' });
    expect(() => structuredResumeV1Schema.parse(resume)).toThrow();
  });

  it('rejects a non-array education field', () => {
    const resume = { ...createEmptyStructuredResume(HEADER), education: 'not-an-array' };
    expect(() => structuredResumeV1Schema.parse(resume)).toThrow();
  });

  it('rejects an excessively long bullet', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      experience: [
        {
          id: 'x1',
          organization: 'Acme',
          role: 'Engineer',
          location: null,
          dateRange: { start: null, end: null, isPresent: false },
          bullets: [{ id: 'b1', text: 'x'.repeat(601), provenance: { type: 'MANUAL' } }],
        },
      ],
    };
    expect(() => structuredResumeV1Schema.parse(resume)).toThrow();
  });

  it('accepts an omitted (optional) skill group with no items', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      skills: [{ id: 's1', label: 'Languages', items: [] }],
    };
    expect(() => structuredResumeV1Schema.parse(resume)).not.toThrow();
  });

  it('preserves array order on round-trip', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      skills: [
        { id: 's1', label: 'B', items: [] },
        { id: 's2', label: 'A', items: [] },
      ],
    };
    const parsed = structuredResumeV1Schema.parse(resume);
    expect(parsed.skills.map((s) => s.label)).toEqual(['B', 'A']);
  });

  it('accepts a custom render override', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      renderOverride: { latex: '\\documentclass{article}' },
    };
    expect(() => structuredResumeV1Schema.parse(resume)).not.toThrow();
  });
});

describe('resumeBulletProvenanceSchema', () => {
  it('accepts MANUAL with no sourceFactIds', () => {
    expect(() => resumeBulletProvenanceSchema.parse({ type: 'MANUAL' })).not.toThrow();
  });

  it('accepts CANDIDATE_FACTS with at least one sourceFactId', () => {
    expect(() =>
      resumeBulletProvenanceSchema.parse({
        type: 'CANDIDATE_FACTS',
        sourceFactIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    ).not.toThrow();
  });

  it('rejects CANDIDATE_FACTS with an empty sourceFactIds array', () => {
    expect(() =>
      resumeBulletProvenanceSchema.parse({ type: 'CANDIDATE_FACTS', sourceFactIds: [] }),
    ).toThrow();
  });

  it('rejects an unknown provenance type', () => {
    expect(() => resumeBulletProvenanceSchema.parse({ type: 'AI_GENERATED' })).toThrow();
  });
});

describe('resumeDateRangeSchema', () => {
  it('rejects isPresent: true combined with a non-null end date', () => {
    expect(() =>
      resumeDateRangeSchema.parse({
        start: { year: 2024, month: 1 },
        end: { year: 2025, month: 1 },
        isPresent: true,
      }),
    ).toThrow();
  });

  it('accepts isPresent: true with a null end date', () => {
    expect(() =>
      resumeDateRangeSchema.parse({
        start: { year: 2024, month: 1 },
        end: null,
        isPresent: true,
      }),
    ).not.toThrow();
  });
});

describe('createResumeEntryId', () => {
  it('generates distinct ids', () => {
    expect(createResumeEntryId()).not.toBe(createResumeEntryId());
  });
});
