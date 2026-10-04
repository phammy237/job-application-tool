import { describe, expect, it } from 'vitest';
import type { Visibility } from '../../schemas/myos';
import {
  achievement,
  edge,
  evidence,
  graphOf,
  project,
  skill,
  story,
} from './graph-fixtures';
import type { EvidenceGraphData } from './graph-types';
import { buildPortfolioExport, portfolioExportSchema } from './portfolio';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const SETTINGS = { displayName: 'Jane Doe', headline: 'Builder' };

describe('buildPortfolioExport', () => {
  it('exports a versioned, schema-valid document with only public+approved items', () => {
    const sk = skill({ name: 'Python', visibility: 'PUBLIC' });
    const hidden = skill({ name: 'SecretSkill', visibility: 'PRIVATE' });
    const p = project({
      name: 'Open Project',
      visibility: 'PUBLIC',
      startDate: '2025-01-01',
      collaborators: ['Bob Hidden'],
      talkingPoints: ['TP hidden'],
    });
    const pendingApproval = project({
      name: 'Unapproved',
      visibility: 'PUBLIC',
      userApproved: false,
    });
    const ev = evidence({
      title: 'Public repo',
      sourceUrl: 'https://github.com/a/b',
      excerpt: 'EXCERPT-SECRET',
      visibility: 'PUBLIC',
      metadata: { k: 'META-SECRET' },
    });
    const privEv = evidence({ title: 'Private notes', visibility: 'CAREER_OS_ONLY' });
    const ach = achievement({
      title: 'Public win',
      visibility: 'PUBLIC',
      projectId: p.id,
      occurredOn: '2025-05-01',
    });
    const g = graphOf({
      projects: [p, pendingApproval],
      skills: [sk, hidden],
      evidence: [ev, privEv],
      achievements: [ach],
      stories: [story({ title: 'Story title', visibility: 'PUBLIC' })],
      edges: [
        edge(['PROJECT', p.id], ['SKILL', sk.id], 'DEMONSTRATES'),
        edge(['PROJECT', p.id], ['SKILL', hidden.id], 'DEMONSTRATES'),
        edge(['EVIDENCE', ev.id], ['PROJECT', p.id], 'SUPPORTS'),
        edge(['EVIDENCE', privEv.id], ['PROJECT', p.id], 'SUPPORTS'),
      ],
    });
    const out = buildPortfolioExport(g, SETTINGS, NOW);
    expect(portfolioExportSchema.safeParse(out).success).toBe(true);
    expect(out.schemaVersion).toBe('myos.portfolio.v1');
    expect(out.generatedAt).toBe('2026-06-15T12:00:00.000Z');
    expect(out.profile).toEqual(SETTINGS);
    expect(out.projects.map((x) => x.name)).toEqual(['Open Project']);
    expect(out.projects[0]!.skillIds).toEqual([sk.id]);
    expect(out.projects[0]!.evidence).toEqual([
      {
        sourceType: 'LINK',
        title: 'Public repo',
        url: 'https://github.com/a/b',
        verificationState: 'USER_PROVIDED',
      },
    ]);
    expect(out.skills.map((x) => x.name)).toEqual(['Python']);
    expect(out.skills[0]!.projectIds).toEqual([p.id]);
    expect(out.achievements[0]).toMatchObject({ title: 'Public win', projectId: p.id });
    expect(out.timeline.map((t) => t.title).sort()).toEqual([
      'Open Project',
      'Public win',
    ]);
    expect(
      out.timeline.find((t) => t.title === 'Open Project')!.relatedSkillNames,
    ).toEqual(['Python']);

    const json = JSON.stringify(out);
    for (const secret of [
      'Bob Hidden',
      'TP hidden',
      'EXCERPT-SECRET',
      'META-SECRET',
      'SecretSkill',
      'Unapproved',
      'Private notes',
      'Story title',
      'href',
      '/my/',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('nulls an achievement link to a non-public project', () => {
    const p = project({ name: 'Private proj', visibility: 'PRIVATE' });
    const ach = achievement({
      visibility: 'PUBLIC',
      projectId: p.id,
      title: 'Public ach',
      occurredOn: '2025-01-01',
    });
    const g = graphOf({
      projects: [p],
      achievements: [ach],
      edges: [edge(['ACHIEVEMENT', ach.id], ['PROJECT', p.id], 'BELONGS_TO')],
    });
    const out = buildPortfolioExport(g, SETTINGS, NOW);
    expect(out.achievements[0]!.projectId).toBeNull();
    expect(out.timeline[0]!.subtitle).toBeNull();
    expect(JSON.stringify(out)).not.toContain(p.id);
    expect(JSON.stringify(out)).not.toContain('Private proj');
  });

  it('drops AI-generated edges from public cross-links', () => {
    const p = project({ visibility: 'PUBLIC' });
    const sk = skill({ name: 'Guess', visibility: 'PUBLIC' });
    const g = graphOf({
      projects: [p],
      skills: [sk],
      edges: [edge(['PROJECT', p.id], ['SKILL', sk.id], 'USES', 'AI_GENERATED')],
    });
    expect(buildPortfolioExport(g, SETTINGS, NOW).projects[0]!.skillIds).toEqual([]);
  });

  it('is deterministic for the same input and clock', () => {
    const g = graphOf({ projects: [project({ visibility: 'PUBLIC' })] });
    expect(buildPortfolioExport(g, SETTINGS, NOW)).toEqual(
      buildPortfolioExport(g, SETTINGS, NOW),
    );
  });
});

// --------------------------------------------------------------------------------------------
// Fuzz: mixed visibilities, nothing non-public may appear anywhere in the serialized output.
// --------------------------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('portfolio export leak fuzz', () => {
  const VIS: Visibility[] = ['PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC'];

  for (let seed = 1; seed <= 40; seed++) {
    it(`leaks no non-public item (seed ${seed})`, () => {
      const rnd = lcg(seed * 7919);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
      const approved = (): boolean => rnd() > 0.3;

      const projects = Array.from({ length: 8 }, (_, i) =>
        project({
          name: `PROJ-${seed}-${i}-NAME`,
          description: `DESC-${seed}-${i}`,
          summary: `SUM-${seed}-${i}`,
          url: `https://example.com/p/${seed}/${i}`,
          visibility: pick(VIS),
          userApproved: approved(),
          startDate: '2024-01-01',
          collaborators: [`COLLAB-${seed}-${i}`],
          talkingPoints: [`TALK-${seed}-${i}`],
        }),
      );
      const skills = Array.from({ length: 8 }, (_, i) =>
        skill({
          name: `SKILL-${seed}-${i}-NAME`,
          visibility: pick(VIS),
          userApproved: approved(),
        }),
      );
      const evs = Array.from({ length: 8 }, (_, i) =>
        evidence({
          title: `EV-${seed}-${i}-TITLE`,
          sourceUrl: `https://example.org/e/${seed}/${i}`,
          excerpt: `EXC-${seed}-${i}`,
          metadata: { note: `META-${seed}-${i}` },
          visibility: pick(VIS),
        }),
      );
      const achs = Array.from({ length: 8 }, (_, i) =>
        achievement({
          title: `ACH-${seed}-${i}-TITLE`,
          description: `AWDTXT-${seed}-${i}`,
          metricText: `METRIC-${seed}-${i}`,
          visibility: pick(VIS),
          userApproved: approved(),
          occurredOn: '2025-02-02',
          projectId: rnd() > 0.5 ? pick(projects).id : null,
        }),
      );
      const stories = Array.from({ length: 4 }, (_, i) =>
        story({
          title: `STORY-${seed}-${i}-TITLE`,
          situation: `SIT-${seed}-${i}`,
          visibility: pick(VIS),
          userApproved: approved(),
        }),
      );

      const edges: EvidenceGraphData['edges'] = [];
      for (let i = 0; i < 30; i++) {
        const r = rnd();
        if (r < 0.35)
          edges.push(
            edge(
              ['PROJECT', pick(projects).id],
              ['SKILL', pick(skills).id],
              pick(['DEMONSTRATES', 'USES'] as const),
              pick(['VERIFIED', 'INFERRED', 'AI_GENERATED'] as const),
            ),
          );
        else if (r < 0.7)
          edges.push(
            edge(['EVIDENCE', pick(evs).id], ['PROJECT', pick(projects).id], 'SUPPORTS'),
          );
        else if (r < 0.85)
          edges.push(
            edge(
              ['ACHIEVEMENT', pick(achs).id],
              ['PROJECT', pick(projects).id],
              'BELONGS_TO',
            ),
          );
        else
          edges.push(
            edge(['STORY', pick(stories).id], ['SKILL', pick(skills).id], 'DEMONSTRATES'),
          );
      }
      const g = graphOf({
        projects,
        skills,
        evidence: evs,
        achievements: achs,
        stories,
        edges,
      });

      const out = buildPortfolioExport(g, SETTINGS, NOW);
      expect(portfolioExportSchema.safeParse(out).success).toBe(true);
      const json = JSON.stringify(out);

      const exposed = (vis: Visibility, ok: boolean): boolean => vis === 'PUBLIC' && ok;
      const check = (id: string, strings: string[], allowed: boolean): void => {
        if (allowed) return;
        for (const s of [id, ...strings]) expect(json, `leaked ${s}`).not.toContain(s);
      };
      for (const [i, p] of projects.entries()) {
        check(
          p.id,
          [
            `PROJ-${seed}-${i}-NAME`,
            `DESC-${seed}-${i}`,
            `SUM-${seed}-${i}`,
            `/p/${seed}/${i}`,
          ],
          exposed(p.visibility, p.userApproved),
        );
        // never exported even for public projects
        expect(json).not.toContain(`COLLAB-${seed}-${i}`);
        expect(json).not.toContain(`TALK-${seed}-${i}`);
      }
      for (const [i, s] of skills.entries())
        check(s.id, [`SKILL-${seed}-${i}-NAME`], exposed(s.visibility, s.userApproved));
      for (const [i, a] of achs.entries())
        check(
          a.id,
          [`ACH-${seed}-${i}-TITLE`, `AWDTXT-${seed}-${i}`, `METRIC-${seed}-${i}`],
          exposed(a.visibility, a.userApproved),
        );
      for (const [i, e] of evs.entries()) {
        // evidence is only ever shown as title+url, and only when PUBLIC
        check(
          e.id,
          [`EV-${seed}-${i}-TITLE`, `/e/${seed}/${i}`],
          e.visibility === 'PUBLIC',
        );
        expect(json).not.toContain(`EXC-${seed}-${i}`);
        expect(json).not.toContain(`META-${seed}-${i}`);
        expect(json).not.toContain(e.id);
      }
      for (const [i, s] of stories.entries())
        check(s.id, [`STORY-${seed}-${i}-TITLE`, `SIT-${seed}-${i}`], false);
      // public achievement pointing at a non-exported project must not carry that project's id
      for (const a of out.achievements) {
        if (a.projectId)
          expect(out.projects.some((p) => p.id === a.projectId)).toBe(true);
      }
    });
  }
});
