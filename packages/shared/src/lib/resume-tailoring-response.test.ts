import { describe, expect, it } from 'vitest';
import { createEmptyStructuredResume, type StructuredResumeV1 } from '../schemas/resume-content';
import type { ResumeTailoringOperation } from '../schemas/resume-tailoring';
import {
  buildResumeTailoringOperationViews,
  computeResumeTailoringCoverage,
  computeResumeTailoringSummary,
} from './resume-tailoring-response';

const HEADER = { fullName: 'Ada Lovelace', email: null, phone: null, location: null, links: {} };
const FACT_1 = '11111111-1111-1111-1111-111111111111';
const FACT_2 = '22222222-2222-2222-2222-222222222222';

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
        ],
      },
    ],
    skills: [
      { id: 'skill-1', label: 'Languages', items: ['Python'] },
      { id: 'skill-2', label: 'Frameworks', items: ['React'] },
    ],
  };
}

const FACT_LABELS = new Map([
  [FACT_1, 'Led a team of 5 engineers'],
  [FACT_2, 'Shipped the referral feature'],
]);
const REQUIREMENT_TEXT = new Map([
  ['req-1', '5+ years of engineering experience'],
  ['req-2', 'Experience with React'],
]);

describe('buildResumeTailoringOperationViews', () => {
  it('resolves before/after text for a REWRITE_BULLET from the base résumé, not the model', () => {
    const views = buildResumeTailoringOperationViews(
      [
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'Led the referral workflow rebuild',
          sourceFactIds: [FACT_1],
          requirementIds: ['req-1'],
          researchFindingIds: [],
          reason: 'Emphasizes leadership experience relevant to the role',
        },
      ],
      baseResume(),
      FACT_LABELS,
      REQUIREMENT_TEXT,
    );
    expect(views).toEqual([
      {
        type: 'REWRITE_BULLET',
        bulletId: 'b1',
        entryLabel: 'Engineer at Acme',
        before: 'Built the referral workflow',
        after: 'Led the referral workflow rebuild',
        groundedFacts: [{ id: FACT_1, label: 'Led a team of 5 engineers' }],
        relevantRequirements: [{ id: 'req-1', text: '5+ years of engineering experience' }],
        companyRelevance: [],
        reason: 'Emphasizes leadership experience relevant to the role',
      },
    ]);
  });

  it('resolves entryLabel for ADD_BULLET from the target entry', () => {
    const views = buildResumeTailoringOperationViews(
      [
        {
          type: 'ADD_BULLET',
          entryId: 'exp-1',
          proposedText: 'Shipped the referral feature end to end',
          sourceFactIds: [FACT_2],
          requirementIds: [],
          researchFindingIds: [],
          reason: 'Adds grounded coverage',
        },
      ],
      baseResume(),
      FACT_LABELS,
      REQUIREMENT_TEXT,
    );
    expect(views[0]).toMatchObject({
      type: 'ADD_BULLET',
      entryLabel: 'Engineer at Acme',
      after: 'Shipped the referral feature end to end',
      groundedFacts: [{ id: FACT_2, label: 'Shipped the referral feature' }],
    });
  });

  it('resolves omittedText for OMIT_BULLET from the base résumé', () => {
    const views = buildResumeTailoringOperationViews(
      [{ type: 'OMIT_BULLET', bulletId: 'b2', researchFindingIds: [], reason: 'Not relevant to this role' }],
      baseResume(),
      FACT_LABELS,
      REQUIREMENT_TEXT,
    );
    expect(views[0]).toEqual({
      type: 'OMIT_BULLET',
      bulletId: 'b2',
      entryLabel: 'Engineer at Acme',
      omittedText: 'Improved onboarding flow',
      companyRelevance: [],
      reason: 'Not relevant to this role',
    });
  });

  it('resolves fromIndex/toIndex for MOVE_BULLET', () => {
    const views = buildResumeTailoringOperationViews(
      [
        {
          type: 'MOVE_BULLET',
          bulletId: 'b2',
          targetIndex: 0,
          researchFindingIds: [],
          reason: 'Lead with this bullet',
        },
      ],
      baseResume(),
      FACT_LABELS,
      REQUIREMENT_TEXT,
    );
    expect(views[0]).toMatchObject({ fromIndex: 1, toIndex: 0, movedText: 'Improved onboarding flow' });
  });

  it('resolves before/after skill labels for REORDER_SKILLS', () => {
    const views = buildResumeTailoringOperationViews(
      [
        {
          type: 'REORDER_SKILLS',
          orderedSkillGroupIds: ['skill-2', 'skill-1'],
          researchFindingIds: [],
          reason: 'Frameworks first',
        },
      ],
      baseResume(),
      FACT_LABELS,
      REQUIREMENT_TEXT,
    );
    expect(views[0]).toEqual({
      type: 'REORDER_SKILLS',
      before: ['Languages', 'Frameworks'],
      after: ['Frameworks', 'Languages'],
      orderedSkillGroupIds: ['skill-2', 'skill-1'],
      companyRelevance: [],
      reason: 'Frameworks first',
    });
  });

  it('falls back to the raw id label when a fact or requirement id has no known label', () => {
    const views = buildResumeTailoringOperationViews(
      [
        {
          type: 'REWRITE_BULLET',
          bulletId: 'b1',
          proposedText: 'New text',
          sourceFactIds: [FACT_1],
          requirementIds: ['req-unknown'],
          researchFindingIds: [],
          reason: 'x',
        },
      ],
      baseResume(),
      new Map(), // no labels known
      new Map(),
    );
    expect(views[0]).toMatchObject({
      groundedFacts: [{ id: FACT_1, label: FACT_1 }],
      relevantRequirements: [{ id: 'req-unknown', text: 'req-unknown' }],
    });
  });

  it('resolves a researchFindingIds citation into companyRelevance, and silently drops an id with no resolvable context', () => {
    const researchFindingsById = new Map([
      ['finding-1', { claim: 'Company is expanding its platform team', roleRelevance: 'Directly relevant', category: 'HIRING' }],
    ]);
    const views = buildResumeTailoringOperationViews(
      [
        {
          type: 'MOVE_BULLET',
          bulletId: 'b2',
          targetIndex: 0,
          researchFindingIds: ['finding-1', 'finding-unresolvable'],
          reason: 'Company research suggests this is more relevant now',
        },
      ],
      baseResume(),
      FACT_LABELS,
      REQUIREMENT_TEXT,
      researchFindingsById,
    );
    expect(views[0]).toMatchObject({
      companyRelevance: [
        {
          id: 'finding-1',
          claim: 'Company is expanding its platform team',
          roleRelevance: 'Directly relevant',
          category: 'HIRING',
        },
      ],
    });
  });
});

describe('computeResumeTailoringSummary', () => {
  it('counts each operation type from the validated operations, never from the model', () => {
    const ops: ResumeTailoringOperation[] = [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'x', sourceFactIds: [], requirementIds: ['req-1'], researchFindingIds: [], reason: 'x' },
      { type: 'REWRITE_BULLET', bulletId: 'b2', proposedText: 'y', sourceFactIds: [], requirementIds: [], researchFindingIds: [], reason: 'x' },
      { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'z', sourceFactIds: [FACT_1], requirementIds: ['req-2'], researchFindingIds: [], reason: 'x' },
      { type: 'OMIT_BULLET', bulletId: 'b3', researchFindingIds: [], reason: 'x' },
      { type: 'OMIT_ENTRY', entryId: 'exp-2', researchFindingIds: [], reason: 'x' },
      { type: 'MOVE_BULLET', bulletId: 'b4', targetIndex: 0, researchFindingIds: [], reason: 'x' },
      { type: 'MOVE_ENTRY', entryId: 'exp-3', targetIndex: 0, researchFindingIds: [], reason: 'x' },
      { type: 'REORDER_SKILLS', orderedSkillGroupIds: ['skill-1'], researchFindingIds: [], reason: 'x' },
    ];
    expect(computeResumeTailoringSummary(ops)).toEqual({
      rewrittenBullets: 2,
      addedBullets: 1,
      omittedBullets: 1,
      omittedEntries: 1,
      movedBullets: 1,
      movedEntries: 1,
      skillsReordered: true,
      requirementsReferenced: 2,
      researchFindingsReferenced: 0,
      operationsInfluencedByResearch: 0,
    });
  });

  it('deduplicates requirement ids referenced by multiple operations', () => {
    const ops: ResumeTailoringOperation[] = [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'x', sourceFactIds: [], requirementIds: ['req-1'], researchFindingIds: [], reason: 'x' },
      { type: 'ADD_BULLET', entryId: 'exp-1', proposedText: 'z', sourceFactIds: [FACT_1], requirementIds: ['req-1'], researchFindingIds: [], reason: 'x' },
    ];
    expect(computeResumeTailoringSummary(ops).requirementsReferenced).toBe(1);
  });

  it('returns all-zero counts for an empty operation list', () => {
    expect(computeResumeTailoringSummary([])).toEqual({
      rewrittenBullets: 0,
      addedBullets: 0,
      omittedBullets: 0,
      omittedEntries: 0,
      movedBullets: 0,
      movedEntries: 0,
      skillsReordered: false,
      requirementsReferenced: 0,
      researchFindingsReferenced: 0,
      operationsInfluencedByResearch: 0,
    });
  });

  it('counts distinct researchFindingsReferenced and operationsInfluencedByResearch across operation types', () => {
    const ops: ResumeTailoringOperation[] = [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'x', sourceFactIds: [], requirementIds: [], researchFindingIds: ['f-1', 'f-2'], reason: 'x' },
      { type: 'OMIT_BULLET', bulletId: 'b2', researchFindingIds: ['f-2'], reason: 'x' },
      { type: 'MOVE_ENTRY', entryId: 'exp-1', targetIndex: 0, researchFindingIds: [], reason: 'x' },
    ];
    const summary = computeResumeTailoringSummary(ops);
    expect(summary.researchFindingsReferenced).toBe(2);
    expect(summary.operationsInfluencedByResearch).toBe(2);
  });
});

describe('computeResumeTailoringCoverage', () => {
  const REQUIREMENTS = [
    { id: 'req-1', text: '5+ years of engineering experience' },
    { id: 'req-2', text: 'Experience with React' },
    { id: 'req-3', text: 'Experience with Snowflake' },
  ];

  it('with a real mapping present, uses the mapping\'s own MISSING relationships', () => {
    const mappingIsMissing = new Map([
      ['req-1', false],
      ['req-2', false],
      ['req-3', true],
    ]);
    const coverage = computeResumeTailoringCoverage([], REQUIREMENTS, mappingIsMissing);
    expect(coverage.coveredRequirementIds).toEqual(['req-1', 'req-2']);
    expect(coverage.unsupportedRequirementIds).toEqual(['req-3']);
    expect(coverage.unsupportedRequirements).toEqual([
      { id: 'req-3', text: 'Experience with Snowflake' },
    ]);
  });

  it('with no mapping (fallback), coverage reflects only what validated operations actually cited', () => {
    const ops: ResumeTailoringOperation[] = [
      { type: 'REWRITE_BULLET', bulletId: 'b1', proposedText: 'x', sourceFactIds: [], requirementIds: ['req-1'], researchFindingIds: [], reason: 'x' },
    ];
    const coverage = computeResumeTailoringCoverage(ops, REQUIREMENTS, null);
    expect(coverage.coveredRequirementIds).toEqual(['req-1']);
    expect(coverage.unsupportedRequirementIds).toEqual(['req-2', 'req-3']);
    expect(coverage.referencedRequirementIds).toEqual(['req-1']);
  });

  it('never invents coverage for a requirement no operation actually cited', () => {
    const coverage = computeResumeTailoringCoverage([], REQUIREMENTS, null);
    expect(coverage.coveredRequirementIds).toEqual([]);
    expect(coverage.unsupportedRequirementIds).toEqual(['req-1', 'req-2', 'req-3']);
  });

  it('reports the correct total requirement count regardless of coverage', () => {
    const coverage = computeResumeTailoringCoverage([], REQUIREMENTS, null);
    expect(coverage.totalRequirementCount).toBe(3);
  });

  it('a requirement missing from mappingIsMissing defaults to unsupported, never silently covered', () => {
    const mappingIsMissing = new Map([['req-1', false]]); // req-2/req-3 absent from the map
    const coverage = computeResumeTailoringCoverage([], REQUIREMENTS, mappingIsMissing);
    expect(coverage.coveredRequirementIds).toEqual(['req-1']);
    expect(coverage.unsupportedRequirementIds).toEqual(['req-2', 'req-3']);
  });
});
