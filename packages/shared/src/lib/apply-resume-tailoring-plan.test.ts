import { describe, expect, it } from 'vitest';
import { createEmptyStructuredResume, type StructuredResumeV1 } from '../schemas/resume-content';
import type { ResumeTailoringOperation } from '../schemas/resume-tailoring';
import { applyResumeTailoringPlan } from './apply-resume-tailoring-plan';

const HEADER = { fullName: 'Ada Lovelace', email: null, phone: null, location: null, links: {} };

function baseResume(): StructuredResumeV1 {
  return {
    ...createEmptyStructuredResume(HEADER),
    experience: [
      {
        id: 'exp-1',
        organization: 'Acme',
        role: 'Engineer',
        location: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [
          { id: 'b1', text: 'Built the referral workflow', provenance: { type: 'MANUAL' } },
          { id: 'b2', text: 'Improved onboarding flow', provenance: { type: 'MANUAL' } },
          { id: 'b3', text: 'Wrote documentation', provenance: { type: 'MANUAL' } },
        ],
      },
      {
        id: 'exp-2',
        organization: 'Beta Corp',
        role: 'Intern',
        location: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [{ id: 'b4', text: 'Assisted with support tickets', provenance: { type: 'MANUAL' } }],
      },
    ],
    projects: [
      {
        id: 'proj-1',
        name: 'Side Project',
        role: null,
        url: null,
        dateRange: { start: null, end: null, isPresent: false },
        bullets: [],
      },
    ],
    skills: [
      { id: 'skill-1', label: 'Languages', items: ['Python'] },
      { id: 'skill-2', label: 'Frameworks', items: ['React'] },
    ],
  };
}

describe('applyResumeTailoringPlan', () => {
  it('never mutates the input base résumé', () => {
    const base = baseResume();
    const frozenSnapshot = JSON.parse(JSON.stringify(base));
    applyResumeTailoringPlan(base, [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'Changed', sourceFactIds: [], requirementIds: [], reason: 'x' },
      { type: 'OMIT_BULLET', bulletId: 'b2', reason: 'x' },
    ]);
    expect(base).toEqual(frozenSnapshot);
  });

  it('rewrites a bullet\'s text while preserving its id', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'New text', sourceFactIds: [], requirementIds: [], reason: 'x' },
    ]);
    const bullet = proposed.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.text).toBe('New text');
    expect(bullet?.id).toBe('b1');
  });

  it('sets CANDIDATE_FACTS provenance on a rewrite that cites facts', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'New text', sourceFactIds: ['fact-1'], requirementIds: [], reason: 'x' },
    ]);
    const bullet = proposed.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.provenance).toEqual({ type: 'CANDIDATE_FACTS', sourceFactIds: ['fact-1'] });
  });

  it('preserves the original provenance on a rewrite that cites no new facts', () => {
    const base = baseResume();
    base.experience[0]!.bullets[0]!.provenance = { type: 'CANDIDATE_FACTS', sourceFactIds: ['old-fact'] };
    const proposed = applyResumeTailoringPlan(base, [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'Reworded only', sourceFactIds: [], requirementIds: [], reason: 'x' },
    ]);
    const bullet = proposed.experience[0]!.bullets.find((b) => b.id === 'b1');
    expect(bullet?.provenance).toEqual({ type: 'CANDIDATE_FACTS', sourceFactIds: ['old-fact'] });
  });

  it('adds a new bullet with a server-generated id, never a model-supplied one', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'Added bullet', sourceFactIds: ['fact-1'], requirementIds: [], reason: 'x' },
    ]);
    const bullets = proposed.experience[0]!.bullets;
    expect(bullets).toHaveLength(4);
    const added = bullets[bullets.length - 1]!;
    expect(added.text).toBe('Added bullet');
    expect(added.provenance).toEqual({ type: 'CANDIDATE_FACTS', sourceFactIds: ['fact-1'] });
    expect(added.id).not.toBe('');
    expect(['b1', 'b2', 'b3']).not.toContain(added.id);
  });

  it('omits a bullet entirely', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'OMIT_BULLET', bulletId: 'b2', reason: 'x' },
    ]);
    expect(proposed.experience[0]!.bullets.map((b) => b.id)).toEqual(['b1', 'b3']);
  });

  it('omits an entry entirely', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'OMIT_ENTRY', entryId: 'exp-2', reason: 'x' },
    ]);
    expect(proposed.experience.map((e) => e.id)).toEqual(['exp-1']);
  });

  it('moves a bullet within its own entry', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'MOVE_BULLET', bulletId: 'b3', targetIndex: 0, reason: 'x' },
    ]);
    expect(proposed.experience[0]!.bullets.map((b) => b.id)).toEqual(['b3', 'b1', 'b2']);
  });

  it('moves an entry within its own section', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'MOVE_ENTRY', entryId: 'exp-2', targetIndex: 0, reason: 'x' },
    ]);
    expect(proposed.experience.map((e) => e.id)).toEqual(['exp-2', 'exp-1']);
  });

  it('reorders skill groups', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'REORDER_SKILLS', orderedSkillGroupIds: ['skill-2', 'skill-1'], reason: 'x' },
    ]);
    expect(proposed.skills.map((g) => g.id)).toEqual(['skill-2', 'skill-1']);
    // Items within each group are untouched.
    expect(proposed.skills[0]!.items).toEqual(['React']);
  });

  it('applies several nonconflicting operations together deterministically', () => {
    const ops: ResumeTailoringOperation[] = [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'Rewritten', sourceFactIds: [], requirementIds: [], reason: 'x' },
      { type: 'OMIT_BULLET', bulletId: 'b2', reason: 'x' },
      { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'New', sourceFactIds: ['fact-1'], requirementIds: [], reason: 'x' },
      { type: 'MOVE_ENTRY', entryId: 'proj-1', targetIndex: 0, reason: 'x' },
      { type: 'REORDER_SKILLS', orderedSkillGroupIds: ['skill-2', 'skill-1'], reason: 'x' },
    ];
    const proposed = applyResumeTailoringPlan(baseResume(), ops);

    expect(proposed.experience[0]!.bullets.map((b) => b.text)).toEqual([
      'Rewritten',
      'Wrote documentation',
      'New',
    ]);
    expect(proposed.projects.map((p) => p.id)).toEqual(['proj-1']); // only one project, still first
    expect(proposed.skills.map((g) => g.id)).toEqual(['skill-2', 'skill-1']);
  });

  it('produces no duplicate ids anywhere after a mix of adds/omits/moves', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'One', sourceFactIds: ['f1'], requirementIds: [], reason: 'x' },
      { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'Two', sourceFactIds: ['f1'], requirementIds: [], reason: 'x' },
      { type: 'OMIT_BULLET', bulletId: 'b3', reason: 'x' },
      { type: 'MOVE_BULLET', bulletId: 'b1', targetIndex: 1, reason: 'x' },
    ]);
    const allIds = [
      ...proposed.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]),
      ...proposed.projects.map((p) => p.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('is deterministic — the same base and plan always produce the same array order', () => {
    const ops: ResumeTailoringOperation[] = [
      { type: 'OMIT_BULLET', bulletId: 'b2', reason: 'x' },
      { type: 'MOVE_BULLET', bulletId: 'b3', targetIndex: 0, reason: 'x' },
    ];
    const first = applyResumeTailoringPlan(baseResume(), ops);
    const second = applyResumeTailoringPlan(baseResume(), ops);
    expect(first.experience[0]!.bullets.map((b) => b.id)).toEqual(
      second.experience[0]!.bullets.map((b) => b.id),
    );
  });

  it('preserves section/header content untouched by any operation', () => {
    const proposed = applyResumeTailoringPlan(baseResume(), [
      { type: 'OMIT_BULLET', bulletId: 'b2', reason: 'x' },
    ]);
    expect(proposed.header).toEqual(HEADER);
    expect(proposed.experience[1]).toEqual(baseResume().experience[1]);
  });
});
