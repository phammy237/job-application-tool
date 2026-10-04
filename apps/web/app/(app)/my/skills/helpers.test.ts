import type { MyosEdge, MyosEvidence, RankedSkillStrength } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import {
  addSkillFormSchema,
  detectMissingTechnologies,
  filterSortSkills,
  linkSkillFormSchema,
  parseLinkTarget,
  parseSkillListParams,
  recencyLabel,
  skillEvidenceItems,
} from './helpers';

const U = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function ranked(
  name: string,
  level: RankedSkillStrength['strength']['level'],
  months: number | null,
  category: string | null = null,
  verified = 0,
): RankedSkillStrength {
  return {
    skill: {
      id: name,
      name,
      category,
      visibility: 'PRIVATE',
      userApproved: true,
      approvedForApplications: false,
    },
    strength: {
      level,
      supportingEntities: [],
      evidenceCount: verified,
      verifiedEvidenceCount: verified,
      latestActivity: null,
      monthsSinceLatest: months,
      recency: 'UNKNOWN',
      quality: 'NONE',
      reasons: [],
    },
  };
}

describe('parseSkillListParams', () => {
  it('defaults and sanitises', () => {
    expect(parseSkillListParams({})).toEqual({ q: '', category: '', sort: 'strength' });
    expect(parseSkillListParams({ sort: 'bogus', q: ['  react '] }).sort).toBe('strength');
    expect(parseSkillListParams({ sort: 'recency' }).sort).toBe('recency');
  });
});

describe('filterSortSkills', () => {
  const rows = [
    ranked('Go', 'LIMITED', 40, 'Language'),
    ranked('React', 'STRONG', 2, 'Framework', 2),
    ranked('Postgres', 'MODERATE', 10, null),
    ranked('Rust', 'NONE', null, 'Language'),
  ];

  it('sorts by strength by default', () => {
    const names = filterSortSkills(rows, parseSkillListParams({})).map((r) => r.skill.name);
    expect(names).toEqual(['React', 'Postgres', 'Go', 'Rust']);
  });

  it('sorts by recency with unknown last', () => {
    const names = filterSortSkills(rows, parseSkillListParams({ sort: 'recency' })).map(
      (r) => r.skill.name,
    );
    expect(names).toEqual(['React', 'Postgres', 'Go', 'Rust']);
  });

  it('filters by search and category', () => {
    expect(filterSortSkills(rows, parseSkillListParams({ q: 'REA' })).map((r) => r.skill.name)).toEqual(
      ['React'],
    );
    expect(
      filterSortSkills(rows, parseSkillListParams({ category: 'Language' })).map((r) => r.skill.name),
    ).toEqual(['Go', 'Rust']);
    expect(
      filterSortSkills(rows, parseSkillListParams({ category: '__none__' })).map((r) => r.skill.name),
    ).toEqual(['Postgres']);
  });
});

describe('recencyLabel', () => {
  it('shows month of latest activity', () => {
    expect(recencyLabel('CURRENT', '2026-03-04')).toBe('Current (2026-03)');
    expect(recencyLabel('UNKNOWN', null)).toBe('No dated activity');
  });
});

describe('detectMissingTechnologies', () => {
  const base = {
    projects: [
      {
        id: id(1),
        name: 'Dash',
        description: 'Built with React and PostgreSQL',
        summary: null,
        role: null,
        startDate: null,
        endDate: null,
        url: null,
        tags: ['TypeScript'],
        status: null,
        collaborators: [],
        talkingPoints: [],
        origin: 'MANUAL' as const,
        visibility: 'PRIVATE' as const,
        userApproved: true,
        approvedForApplications: false,
      },
    ],
    experiences: [],
    skills: [] as Array<{
      id: string;
      name: string;
      category: string | null;
      visibility: 'PRIVATE';
      userApproved: boolean;
      approvedForApplications: boolean;
    }>,
  };

  it('suggests technologies without a skill row, case-insensitively excluding existing', () => {
    const names = detectMissingTechnologies(base).map((s) => s.name);
    expect(names).toContain('React');
    expect(names).toContain('TypeScript');
    const withSkill = detectMissingTechnologies({
      ...base,
      skills: [
        {
          id: id(9),
          name: 'react',
          category: null,
          visibility: 'PRIVATE',
          userApproved: true,
          approvedForApplications: false,
        },
      ],
    }).map((s) => s.name);
    expect(withSkill).not.toContain('React');
    expect(withSkill).toContain('TypeScript');
  });

  it('records source names', () => {
    const react = detectMissingTechnologies(base).find((s) => s.name === 'React');
    expect(react?.sources).toEqual(['Dash']);
  });
});

describe('skillEvidenceItems', () => {
  const ev = (n: number, state: MyosEvidence['verificationState']): MyosEvidence => ({
    id: id(n),
    userId: U,
    sourceType: 'LINK',
    sourceRef: null,
    sourceUrl: null,
    title: `Ev ${n}`,
    excerpt: null,
    occurredAt: null,
    confidence: null,
    verificationState: state,
    visibility: 'PRIVATE',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const edge = (n: number, from: string, to: string, state: MyosEdge['verificationState']): MyosEdge => ({
    id: id(100 + n),
    userId: U,
    fromType: 'EVIDENCE',
    fromId: from,
    toType: 'PROJECT',
    toId: to,
    relation: 'SUPPORTS',
    verificationState: state,
    confidence: null,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('collects evidence via skill and entities; AI links never count as verified', () => {
    const items = skillEvidenceItems(
      {
        evidence: [ev(1, 'VERIFIED'), ev(2, 'VERIFIED'), ev(3, 'VERIFIED')],
        edges: [
          edge(1, id(1), id(50), 'USER_PROVIDED'),
          edge(2, id(2), id(50), 'AI_GENERATED'),
          edge(3, id(3), id(77), 'USER_PROVIDED'),
        ],
      },
      id(60),
      [id(50)],
    );
    expect(items.map((i) => i.evidence.id)).toEqual([id(1), id(2)]);
    expect(items.map((i) => i.countsAsVerified)).toEqual([true, false]);
  });
});

describe('form schemas', () => {
  it('validates add skill', () => {
    expect(addSkillFormSchema.safeParse({ name: '  ' }).success).toBe(false);
    const ok = addSkillFormSchema.parse({ name: ' Go ', category: '' });
    expect(ok).toEqual({ name: 'Go', category: null });
  });

  it('validates link targets', () => {
    expect(linkSkillFormSchema.safeParse({ skillId: id(1), target: 'PROJECT:nope' }).success).toBe(
      false,
    );
    const ok = linkSkillFormSchema.parse({ skillId: id(1), target: `EXPERIENCE:${id(2)}` });
    expect(parseLinkTarget(ok.target)).toEqual({ type: 'EXPERIENCE', id: id(2) });
    expect(linkSkillFormSchema.safeParse({ skillId: id(1), target: `STORY:${id(2)}` }).success).toBe(
      false,
    );
  });
});
