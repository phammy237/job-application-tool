import { describe, expect, it } from 'vitest';
import { buildReviewedResumeImportPayload } from './build-reviewed-payload';
import type { ExtractionState } from './types';

function emptyState(): ExtractionState {
  return {
    personal: {
      fullName: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
      email: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
      phone: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
      location: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
      linkedin: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
      portfolio: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
      github: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
      website: { resumeValue: null, existingValue: null, choice: 'exclude', editedValue: '' },
    },
    experience: [],
    education: [],
    projects: [],
    skills: [],
    droppedCount: 0,
  };
}

describe('buildReviewedResumeImportPayload — personal fields', () => {
  it('an excluded field is omitted from the payload entirely', () => {
    const state = emptyState();
    const payload = buildReviewedResumeImportPayload(state);
    expect(payload.personal.fullName).toBeUndefined();
  });

  it('a keep_existing field is omitted — the caller must never overwrite it', () => {
    const state = emptyState();
    state.personal.fullName = {
      resumeValue: 'Jane Doe',
      existingValue: 'Existing Name',
      choice: 'keep_existing',
      editedValue: 'Jane Doe',
    };
    const payload = buildReviewedResumeImportPayload(state);
    expect(payload.personal.fullName).toBeUndefined();
  });

  it('a use_resume field is included with its (possibly edited) value', () => {
    const state = emptyState();
    state.personal.fullName = {
      resumeValue: 'Jane Doe',
      existingValue: null,
      choice: 'use_resume',
      editedValue: 'Jane D. Doe', // user edited it during review
    };
    const payload = buildReviewedResumeImportPayload(state);
    expect(payload.personal.fullName).toBe('Jane D. Doe');
  });
});

describe('buildReviewedResumeImportPayload — collections', () => {
  it('only included entries appear in the flattened output', () => {
    const state = emptyState();
    state.experience = [
      { item: { company: 'Acme', title: 'Engineer', location: null, dateRangeText: null, bullets: [], uncertain: false }, included: true, editing: false, isDuplicate: false },
      { item: { company: 'Excluded Co', title: 'X', location: null, dateRangeText: null, bullets: [], uncertain: false }, included: false, editing: false, isDuplicate: false },
    ];
    const payload = buildReviewedResumeImportPayload(state);
    expect(payload.experience).toHaveLength(1);
    expect(payload.experience[0]?.company).toBe('Acme');
  });

  it('7. an edited item value is what flows through, not the original extraction', () => {
    const state = emptyState();
    state.experience = [
      {
        item: { company: 'Acme Corp (edited)', title: 'Senior Engineer (edited)', location: null, dateRangeText: null, bullets: ['Did a thing'], uncertain: false },
        included: true,
        editing: false,
        isDuplicate: false,
      },
    ];
    const payload = buildReviewedResumeImportPayload(state);
    expect(payload.experience[0]?.company).toBe('Acme Corp (edited)');
    expect(payload.experience[0]?.title).toBe('Senior Engineer (edited)');
    expect(payload.experience[0]?.description).toBe('Did a thing');
  });

  it('experience/education/project start/end dates always stay null — never guessed from dateRangeText', () => {
    const state = emptyState();
    state.experience = [
      { item: { company: 'Acme', title: 'Engineer', location: null, dateRangeText: 'May 2025 - Present', bullets: [], uncertain: false }, included: true, editing: false, isDuplicate: false },
    ];
    const payload = buildReviewedResumeImportPayload(state);
    expect(payload.experience[0]?.startDate).toBeNull();
    expect(payload.experience[0]?.endDate).toBeNull();
  });

  it('skills only carry included entries through with name/category', () => {
    const state = emptyState();
    state.skills = [
      { item: { name: 'TypeScript', category: 'Languages' }, included: true, editing: false, isDuplicate: false },
      { item: { name: 'COBOL', category: null }, included: false, editing: false, isDuplicate: false },
    ];
    const payload = buildReviewedResumeImportPayload(state);
    expect(payload.skills).toEqual([{ name: 'TypeScript', category: 'Languages' }]);
  });
});
