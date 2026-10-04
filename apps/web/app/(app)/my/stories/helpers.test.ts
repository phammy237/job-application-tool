import type { MyosEdge, MyosStory } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import {
  competencyCoverage,
  filterStories,
  parseStoryFilter,
  parseStoryForm,
  storyLinks,
} from './helpers';

const U = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function story(n: number, over: Partial<MyosStory>): MyosStory {
  return {
    id: id(n),
    userId: U,
    title: `Story ${n}`,
    situation: null,
    task: null,
    action: null,
    result: null,
    competencies: [],
    themes: [],
    verificationState: 'USER_PROVIDED',
    userApproved: false,
    visibility: 'PRIVATE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function form(entries: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe('parseStoryForm', () => {
  it('requires a title', () => {
    const res = parseStoryForm(form([['title', ' ']]));
    expect(res).toEqual({ ok: false, message: 'Give the story a title.' });
  });

  it('reads multi-value competencies, themes and links; ignores verificationState', () => {
    const res = parseStoryForm(
      form([
        ['title', ' Shipped it '],
        ['competencies', 'LEADERSHIP'],
        ['competencies', 'OWNERSHIP'],
        ['themes', 'speed, quality, speed'],
        ['projectIds', id(1)],
        ['projectIds', id(1)],
        ['experienceIds', id(2)],
        ['evidenceIds', id(3)],
        ['userApproved', 'on'],
        ['verificationState', 'VERIFIED'],
      ]),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.input).toMatchObject({
        title: 'Shipped it',
        competencies: ['LEADERSHIP', 'OWNERSHIP'],
        themes: ['speed', 'quality'],
        userApproved: true,
        visibility: 'PRIVATE',
      });
      expect('verificationState' in res.value.input).toBe(false);
      expect(res.value.projectIds).toEqual([id(1)]);
      expect(res.value.experienceIds).toEqual([id(2)]);
      expect(res.value.evidenceIds).toEqual([id(3)]);
    }
  });

  it('rejects unknown competencies and bad ids', () => {
    expect(
      parseStoryForm(
        form([
          ['title', 'x'],
          ['competencies', 'CHARISMA'],
        ]),
      ).ok,
    ).toBe(false);
    expect(
      parseStoryForm(
        form([
          ['title', 'x'],
          ['projectIds', 'nope'],
        ]),
      ).ok,
    ).toBe(false);
  });
});

describe('filters and coverage', () => {
  const stories = [
    story(1, { competencies: ['LEADERSHIP', 'OWNERSHIP'], userApproved: true }),
    story(2, { competencies: ['LEADERSHIP'] }),
    story(3, { competencies: ['FAILURE'] }),
  ];

  it('filters by competency and approved-only', () => {
    expect(
      filterStories(stories, { competency: 'LEADERSHIP', approvedOnly: false }),
    ).toHaveLength(2);
    expect(
      filterStories(stories, { competency: 'LEADERSHIP', approvedOnly: true }),
    ).toHaveLength(1);
    expect(
      filterStories(stories, { competency: null, approvedOnly: false }),
    ).toHaveLength(3);
  });

  it('parses filter params defensively', () => {
    expect(parseStoryFilter({ competency: 'bogus', approved: '1' })).toEqual({
      competency: null,
      approvedOnly: true,
    });
  });

  it('only approved stories cover a competency', () => {
    const cov = competencyCoverage(stories);
    expect(cov).toHaveLength(11);
    const by = Object.fromEntries(cov.map((c) => [c.competency, c]));
    expect(by.LEADERSHIP).toMatchObject({ approvedCount: 1, totalCount: 2 });
    expect(by.OWNERSHIP?.approvedCount).toBe(1);
    expect(by.FAILURE).toMatchObject({ approvedCount: 0, totalCount: 1 });
    expect(by.EXECUTION).toMatchObject({ approvedCount: 0, totalCount: 0 });
  });
});

describe('storyLinks', () => {
  it('collects referenced projects/experiences and supporting evidence only', () => {
    const e = (
      n: number,
      fromType: MyosEdge['fromType'],
      fromId: string,
      toType: MyosEdge['toType'],
      toId: string,
      relation: MyosEdge['relation'],
    ): MyosEdge => ({
      id: id(200 + n),
      userId: U,
      fromType,
      fromId,
      toType,
      toId,
      relation,
      verificationState: 'USER_PROVIDED',
      confidence: null,
      note: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const links = storyLinks(
      {
        projects: [{ id: id(10), name: 'Proj' }] as never,
        experiences: [{ id: id(11), title: 'Eng', company: 'Acme' }] as never,
        evidence: [{ id: id(12), title: 'PR', verificationState: 'VERIFIED' }] as never,
        edges: [
          e(1, 'STORY', id(1), 'PROJECT', id(10), 'REFERENCES'),
          e(2, 'STORY', id(1), 'EXPERIENCE', id(11), 'REFERENCES'),
          e(3, 'EVIDENCE', id(12), 'STORY', id(1), 'SUPPORTS'),
          e(4, 'STORY', id(2), 'PROJECT', id(10), 'REFERENCES'),
          e(5, 'STORY', id(1), 'PROJECT', id(99), 'REFERENCES'),
        ],
      },
      id(1),
    );
    expect(links.projects).toEqual([{ id: id(10), name: 'Proj' }]);
    expect(links.experiences).toEqual([{ id: id(11), name: 'Eng at Acme' }]);
    expect(links.evidence.map((x) => x.id)).toEqual([id(12)]);
  });
});
