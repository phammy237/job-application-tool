import { z } from 'zod';
import {
  achievementKindSchema,
  evidenceSourceTypeSchema,
  projectStatusSchema,
  verificationStateSchema,
} from '../../schemas/myos';
import type { EvidenceGraphData } from './graph-types';
import { buildGraphIndex, nodeKey, otherEnd } from './graph';
import { buildTimeline } from './timeline';

/**
 * Public portfolio export (versioned JSON). The ONLY path by which myOS data leaves Career OS.
 *
 * Inclusion rule: an item is exported iff `visibility === 'PUBLIC'` AND `userApproved === true`.
 * Everything else is dropped before any derived data is computed: the export is built from a
 * filtered copy of the graph, so timelines, skill links, and evidence counts can never reveal a
 * non-public entity.
 *
 * v1 scope:
 *  - Included: profile (displayName, headline), PUBLIC+approved projects, skills, achievements,
 *    and a timeline of those projects/achievements.
 *  - Excluded entirely: stories, experiences, education, candidates, GitHub repository data,
 *    project collaborators and talking points, evidence excerpts/metadata, and in-app hrefs.
 *  - Evidence: only evidence with visibility PUBLIC, and only {sourceType, title, url,
 *    verificationState}. Evidence from a private source (metadata.isPrivate / private /
 *    repoPrivate === true, e.g. a private GitHub repository) is omitted entirely, title and url
 *    included, even when its visibility says PUBLIC.
 *  - Skill links: a project<->skill edge is exported only when the user confirmed it (VERIFIED or
 *    USER_PROVIDED); INFERRED and AI_GENERATED links are dropped.
 *  - Achievement metrics: `metricText` is exported only when a user-confirmed public evidence node
 *    supports the achievement; otherwise it is exported as null.
 *  - Cross-links (project.skillIds, skill.projectIds, achievement.projectId) reference only
 *    exported items; a link to a non-exported node is dropped (achievement.projectId -> null).
 */

export const PORTFOLIO_SCHEMA_VERSION = 'myos.portfolio.v1' as const;

const timelineTypeSchema = z.enum([
  'PROJECT',
  'ACHIEVEMENT',
  'AWARD',
  'LAUNCH',
  'LEADERSHIP',
  'MILESTONE',
]);

export const portfolioExportSchema = z.object({
  schemaVersion: z.literal(PORTFOLIO_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  profile: z.object({
    displayName: z.string().nullable(),
    headline: z.string().nullable(),
  }),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      summary: z.string().nullable(),
      role: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      url: z.string().nullable(),
      tags: z.array(z.string()),
      status: projectStatusSchema.nullable(),
      skillIds: z.array(z.string()),
      evidence: z.array(
        z.object({
          sourceType: evidenceSourceTypeSchema,
          title: z.string(),
          url: z.string().nullable(),
          verificationState: verificationStateSchema,
        }),
      ),
    }),
  ),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string().nullable(),
      projectIds: z.array(z.string()),
    }),
  ),
  achievements: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      kind: achievementKindSchema,
      occurredOn: z.string().nullable(),
      metricText: z.string().nullable(),
      projectId: z.string().nullable(),
      verificationState: verificationStateSchema,
    }),
  ),
  timeline: z.array(
    z.object({
      id: z.string(),
      type: timelineTypeSchema,
      title: z.string(),
      subtitle: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      isOngoing: z.boolean(),
      relatedSkillNames: z.array(z.string()),
    }),
  ),
});
export type PortfolioExport = z.infer<typeof portfolioExportSchema>;

export interface PortfolioSettingsInput {
  displayName: string | null;
  headline: string | null;
}

const CONFIRMED = new Set(['VERIFIED', 'USER_PROVIDED']);

/** True when the evidence points at a private source (e.g. a private GitHub repository). */
function isPrivateSource(e: { metadata: Record<string, unknown> }): boolean {
  const m = e.metadata ?? {};
  return (
    m.isPrivate === true ||
    m.private === true ||
    m.repoPrivate === true ||
    m.isPrivateRepo === true ||
    (typeof m.visibility === 'string' && m.visibility.toLowerCase() === 'private')
  );
}

const isPublicApproved = (x: { visibility: string; userApproved: boolean }): boolean =>
  x.visibility === 'PUBLIC' && x.userApproved === true;

/** The graph restricted to exportable nodes and edges between them. */
export function publicSubgraph(graph: EvidenceGraphData): EvidenceGraphData {
  const projects = graph.projects.filter(isPublicApproved);
  const skills = graph.skills.filter(isPublicApproved);
  const achievements = graph.achievements.filter(isPublicApproved);
  const evidence = graph.evidence.filter(
    (e) => e.visibility === 'PUBLIC' && !isPrivateSource(e),
  );
  const keys = new Set<string>([
    ...projects.map((p) => nodeKey('PROJECT', p.id)),
    ...skills.map((s) => nodeKey('SKILL', s.id)),
    ...achievements.map((a) => nodeKey('ACHIEVEMENT', a.id)),
    ...evidence.map((e) => nodeKey('EVIDENCE', e.id)),
  ]);
  const edges = graph.edges.filter(
    (e) =>
      keys.has(nodeKey(e.fromType, e.fromId)) &&
      keys.has(nodeKey(e.toType, e.toId)) &&
      e.verificationState !== 'AI_GENERATED' &&
      // a skill link must be confirmed by the user, never merely inferred
      (!(e.fromType === 'SKILL' || e.toType === 'SKILL') ||
        CONFIRMED.has(e.verificationState)),
  );
  return {
    projects,
    skills,
    experiences: [],
    education: [],
    achievements,
    stories: [],
    evidence,
    edges,
  };
}

export function buildPortfolioExport(
  graph: EvidenceGraphData,
  settings: PortfolioSettingsInput,
  now: Date,
): PortfolioExport {
  const pub = publicSubgraph(graph);
  const index = buildGraphIndex(pub);

  const linked = (key: string, relations: string[], type: string): string[] => {
    const ids = new Set<string>();
    for (const ie of index.adjacency.get(key) ?? []) {
      if (!relations.includes(ie.edge.relation)) continue;
      const other = index.nodes.get(otherEnd(ie, key));
      if (other?.type === type) ids.add(other.id);
    }
    return [...ids].sort();
  };

  const publicProjectIds = new Set(pub.projects.map((p) => p.id));
  const evidenceById = new Map(pub.evidence.map((e) => [e.id, e]));

  const projects = pub.projects.map((p) => {
    const key = nodeKey('PROJECT', p.id);
    const evidence = linked(key, ['SUPPORTS', 'REPRESENTS'], 'EVIDENCE')
      .map((id) => evidenceById.get(id)!)
      .map((e) => ({
        sourceType: e.sourceType,
        title: e.title,
        url: e.sourceUrl,
        verificationState: e.verificationState,
      }));
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      summary: p.summary,
      role: p.role,
      startDate: p.startDate,
      endDate: p.endDate,
      url: p.url,
      tags: [...p.tags],
      status: p.status,
      skillIds: linked(key, ['DEMONSTRATES', 'USES'], 'SKILL'),
      evidence,
    };
  });

  const skills = pub.skills.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    projectIds: linked(nodeKey('SKILL', s.id), ['DEMONSTRATES', 'USES'], 'PROJECT'),
  }));

  const supportedAchievementIds = new Set<string>();
  for (const e of pub.edges) {
    if (!CONFIRMED.has(e.verificationState)) continue;
    if (e.relation !== 'SUPPORTS' && e.relation !== 'REPRESENTS') continue;
    if (e.fromType === 'EVIDENCE' && e.toType === 'ACHIEVEMENT')
      supportedAchievementIds.add(e.toId);
    if (e.toType === 'EVIDENCE' && e.fromType === 'ACHIEVEMENT')
      supportedAchievementIds.add(e.fromId);
  }
  const achievements = pub.achievements.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    kind: a.kind,
    occurredOn: a.occurredOn,
    metricText: supportedAchievementIds.has(a.id) ? a.metricText : null,
    projectId: a.projectId && publicProjectIds.has(a.projectId) ? a.projectId : null,
    verificationState: a.verificationState,
  }));

  const timeline = buildTimeline(index, { now }).entries.map((e) => ({
    id: e.id,
    type: e.type as z.infer<typeof timelineTypeSchema>,
    title: e.title,
    subtitle: e.subtitle,
    start: e.start,
    end: e.end,
    isOngoing: e.isOngoing,
    relatedSkillNames: e.relatedSkillNames,
  }));
  // Undated achievements/projects stay out of the public timeline but remain in their own lists.

  return portfolioExportSchema.parse({
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    profile: { displayName: settings.displayName, headline: settings.headline },
    projects,
    skills,
    achievements,
    timeline,
  });
}
