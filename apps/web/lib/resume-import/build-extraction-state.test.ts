import type { ResumeExtractionResult } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import { buildExtractionState } from './build-extraction-state';

function baseResult(overrides: Partial<ResumeExtractionResult> = {}): ResumeExtractionResult {
  return {
    personal: {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: null,
      location: null,
      linkedin: null,
      github: null,
      portfolio: null,
      website: null,
    },
    experience: [],
    education: [],
    projects: [],
    skills: [],
    droppedCount: 0,
    ...overrides,
  };
}

describe('buildExtractionState — personal field conflicts', () => {
  it('defaults to use_resume when the existing profile has no value for that field', () => {
    const state = buildExtractionState(baseResult(), null);
    expect(state.personal.fullName.choice).toBe('use_resume');
  });

  it('defaults to keep_existing (never silently overwrites) when both a resume value and a differing existing value are present', () => {
    const state = buildExtractionState(baseResult(), {
      fullName: 'Existing Name',
      email: null,
      phone: null,
      location: null,
      linkedin: null,
      portfolio: null,
      github: null,
      website: null,
    });
    expect(state.personal.fullName.choice).toBe('keep_existing');
    expect(state.personal.fullName.existingValue).toBe('Existing Name');
    expect(state.personal.fullName.resumeValue).toBe('Jane Doe');
  });

  it('defaults to exclude when the resume has no value for that field', () => {
    const state = buildExtractionState(baseResult(), null);
    expect(state.personal.phone.choice).toBe('exclude');
  });
});

describe('buildExtractionState — duplicate detection defaults', () => {
  it('an experience exactly matching an existing row defaults to excluded and flagged as a duplicate', () => {
    const state = buildExtractionState(
      baseResult({
        experience: [{ company: 'Acme', title: 'Engineer', location: null, dateRangeText: null, bullets: ['Did things'], uncertain: false }],
      }),
      null,
      { experience: [{ company: 'Acme', title: 'Engineer', description: 'Did things' }] },
    );
    expect(state.experience[0]?.included).toBe(false);
    expect(state.experience[0]?.isDuplicate).toBe(true);
  });

  it('a non-matching experience defaults to included and not flagged as a duplicate', () => {
    const state = buildExtractionState(
      baseResult({
        experience: [{ company: 'Acme', title: 'Engineer', location: null, dateRangeText: null, bullets: [], uncertain: false }],
      }),
      null,
      { experience: [{ company: 'Different Co', title: 'Other', description: null }] },
    );
    expect(state.experience[0]?.included).toBe(true);
    expect(state.experience[0]?.isDuplicate).toBe(false);
  });

  it('with no `existing` collections provided, nothing is treated as a duplicate (matches /settings/resume-import\'s prior behavior)', () => {
    const state = buildExtractionState(
      baseResult({
        skills: [{ name: 'TypeScript', category: null }],
      }),
      null,
    );
    expect(state.skills[0]?.included).toBe(true);
    expect(state.skills[0]?.isDuplicate).toBe(false);
  });

  it('skill duplicate detection is case-insensitive', () => {
    const state = buildExtractionState(
      baseResult({ skills: [{ name: 'typescript', category: null }] }),
      null,
      { skills: [{ name: 'TypeScript' }] },
    );
    expect(state.skills[0]?.isDuplicate).toBe(true);
    expect(state.skills[0]?.included).toBe(false);
  });
});
