import type { Competency } from '../../schemas/myos';
import { findTechNames } from './bullet-evidence';
import type { EvidenceGraphData } from './graph-types';
import {
  bestEvidenceState,
  buildSupportIndex,
  extractRequirementsFromText,
  isSolidState,
  matchRequirementsToEvidence,
  supportEntityTokens,
  type RequirementInput,
  type RequirementLevel,
  type SupportEntity,
  type SupportIndex,
} from './match-requirements';
import { competencyLabel, detectCompetencies, scoreTokenMatch, tokenize } from './text';

/**
 * Interview preparation from a job posting and the evidence graph.
 *
 * Everything user-specific here (stories, projects, talking points) is a stored row, quoted or
 * referenced by id. The `questionsToPrepare` are templated prompts addressed to the user, never
 * claims about them. Competencies are inferred from the job text by keyword rules (text.ts); a
 * competency is a `gap` when the user has no approved story for it. Unapproved stories are still
 * listed (flagged `unapproved`) so the user can approve them, but do not close the gap.
 */

export interface InterviewJobInput {
  title: string;
  company?: string;
  description: string;
  requirements?: string[];
}

export type StoryStrength = 'STRONG' | 'MODERATE' | 'LIMITED';

export interface PrepStory {
  storyId: string;
  title: string;
  strength: StoryStrength;
  unapproved?: true;
}

export interface CompetencyArea {
  competency: Competency;
  rationale: string;
  stories: PrepStory[];
  gap: boolean;
}

export interface PrepProject {
  projectId: string;
  name: string;
  requirementIds: string[];
  level: RequirementLevel;
  unconfirmed?: true;
  evidenceIds: string[];
}

export interface TalkingPoint {
  text: string;
  projectId: string;
  evidenceIds: string[];
}

export interface InterviewPrep {
  competencyAreas: CompetencyArea[];
  relevantProjects: PrepProject[];
  technicalTalkingPoints: TalkingPoint[];
  productTalkingPoints: TalkingPoint[];
  gaps: string[];
  questionsToPrepare: string[];
}

const QUESTION_TEMPLATES: Record<Competency, string[]> = {
  LEADERSHIP: [
    'Tell me about a time you led a team or initiative without formal authority.',
  ],
  CONFLICT: [
    'Describe a disagreement with a teammate or stakeholder and how you resolved it.',
  ],
  AMBIGUITY: [
    'Tell me about a time you had to make progress with unclear goals or requirements.',
  ],
  FAILURE: ['Describe a project that did not go as planned and what you learned.'],
  TECHNICAL_DECISION_MAKING: ['Walk me through a technical trade-off you made and why.'],
  USER_RESEARCH: [
    'How have you gathered and used user feedback to shape a product decision?',
  ],
  PRIORITIZATION: ['Tell me about a time you had to prioritize among competing demands.'],
  CROSS_FUNCTIONAL_COLLABORATION: [
    'Tell me about working with people from other functions to ship something.',
  ],
  DATA_DRIVEN_DECISIONS: [
    'Describe a decision you made using data, and what the data showed.',
  ],
  OWNERSHIP: ['Tell me about something you owned end to end.'],
  EXECUTION: ['Describe a time you delivered under a tight deadline.'],
};

const PRODUCT_COMPETENCIES: readonly Competency[] = [
  'USER_RESEARCH',
  'PRIORITIZATION',
  'CROSS_FUNCTIONAL_COLLABORATION',
  'DATA_DRIVEN_DECISIONS',
];

const MAX_TALKING_POINTS = 8;
const MAX_PROJECTS = 6;

function storyStrength(e: SupportEntity): StoryStrength {
  const ev = bestEvidenceState(e);
  const own = e.ownState;
  if (own === 'INFERRED' || own === 'AI_GENERATED') return 'LIMITED';
  if (ev !== null && isSolidState(ev)) return 'STRONG';
  if (own !== null && isSolidState(own)) return 'MODERATE';
  return 'LIMITED';
}

const STRENGTH_RANK: Record<StoryStrength, number> = {
  STRONG: 2,
  MODERATE: 1,
  LIMITED: 0,
};

export function buildInterviewPrep(
  graph: EvidenceGraphData,
  job: InterviewJobInput,
  now: Date,
  /** Prebuilt `buildSupportIndex(graph)`; built once here and shared with requirement matching. */
  index: SupportIndex = buildSupportIndex(graph),
): InterviewPrep {
  const requirements: RequirementInput[] =
    job.requirements && job.requirements.length > 0
      ? job.requirements
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .slice(0, 25)
          .map((text, i) => ({ id: `req-${i + 1}`, text: text.slice(0, 300) }))
      : extractRequirementsFromText(job.description);

  const storyByEntity = new Map(
    index.entities.filter((e) => e.entityType === 'STORY').map((e) => [e.entityId, e]),
  );

  // 1. Competencies from requirement text (cited), then from title/description as a fallback.
  const rationale = new Map<Competency, string>();
  for (const r of requirements) {
    for (const c of detectCompetencies(r.text)) {
      if (!rationale.has(c)) rationale.set(c, `Requirement: "${r.text}"`);
    }
  }
  for (const c of detectCompetencies(`${job.title}\n${job.description}`)) {
    if (!rationale.has(c))
      rationale.set(c, `The job title or description mentions ${competencyLabel(c)}.`);
  }

  const competencyAreas: CompetencyArea[] = [];
  for (const [competency, why] of rationale) {
    const stories: PrepStory[] = [];
    const reqText = why.startsWith('Requirement: "') ? why.slice(14, -1) : '';
    const reqTokens = reqText.length > 0 ? tokenize(reqText) : [];
    for (const s of graph.stories) {
      const entity = storyByEntity.get(s.id);
      if (!entity) continue;
      const tagged = s.competencies.includes(competency);
      const textual =
        !tagged &&
        reqText.length > 0 &&
        scoreTokenMatch(reqTokens, supportEntityTokens(entity)).score >= 0.5;
      if (!tagged && !textual) continue;
      stories.push({
        storyId: s.id,
        title: s.title,
        strength: storyStrength(entity),
        ...(s.userApproved ? {} : { unapproved: true as const }),
      });
    }
    stories.sort(
      (a, b) =>
        Number(!!a.unapproved) - Number(!!b.unapproved) ||
        STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength] ||
        a.title.localeCompare(b.title),
    );
    competencyAreas.push({
      competency,
      rationale: why,
      stories,
      gap: !stories.some((s) => !s.unapproved),
    });
  }

  // 2. Relevant projects through requirement matching.
  const result = matchRequirementsToEvidence(graph, requirements, now, index);
  const projectAgg = new Map<string, PrepProject>();
  for (const m of result.matches) {
    for (const s of m.supports) {
      if (s.entityType !== 'PROJECT') continue;
      const cur = projectAgg.get(s.entityId);
      const evIds = s.evidence.map((e) => e.evidenceId);
      if (cur) {
        cur.requirementIds.push(m.requirementId);
        cur.evidenceIds = [...new Set([...cur.evidenceIds, ...evIds])];
        if (m.level === 'STRONG' || (m.level === 'MODERATE' && cur.level !== 'STRONG'))
          cur.level = m.level;
      } else {
        projectAgg.set(s.entityId, {
          projectId: s.entityId,
          name: s.name,
          requirementIds: [m.requirementId],
          level: m.level,
          ...(s.unconfirmed ? { unconfirmed: true as const } : {}),
          evidenceIds: evIds,
        });
      }
    }
  }
  const relevantProjects = [...projectAgg.values()]
    .sort(
      (a, b) =>
        Number(!!a.unconfirmed) - Number(!!b.unconfirmed) ||
        b.requirementIds.length - a.requirementIds.length ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_PROJECTS);

  // 3. Talking points: the user's own stored talking points, approved projects only.
  const technicalTalkingPoints: TalkingPoint[] = [];
  const productTalkingPoints: TalkingPoint[] = [];
  for (const rp of relevantProjects) {
    if (rp.unconfirmed) continue;
    const project = graph.projects.find((p) => p.id === rp.projectId);
    if (!project) continue;
    for (const text of project.talkingPoints) {
      const comps = detectCompetencies(text);
      const technical =
        findTechNames(text).length > 0 || comps.includes('TECHNICAL_DECISION_MAKING');
      const productish = comps.some((c) => PRODUCT_COMPETENCIES.includes(c));
      const point: TalkingPoint = {
        text,
        projectId: rp.projectId,
        evidenceIds: rp.evidenceIds,
      };
      if (technical && technicalTalkingPoints.length < MAX_TALKING_POINTS)
        technicalTalkingPoints.push(point);
      else if (
        (productish || !technical) &&
        productTalkingPoints.length < MAX_TALKING_POINTS
      ) {
        productTalkingPoints.push(point);
      }
    }
  }

  // 4. Gaps and templated questions.
  const gaps: string[] = [];
  for (const m of result.matches) {
    if (m.level === 'NONE')
      gaps.push(`No meaningful evidence found for: "${m.requirementText}"`);
  }
  for (const a of competencyAreas) {
    if (a.gap) {
      gaps.push(
        a.stories.length > 0
          ? `Stories for ${competencyLabel(a.competency)} exist but none are approved yet.`
          : `No story in your profile covers ${competencyLabel(a.competency)}.`,
      );
    }
  }
  const questionsToPrepare = competencyAreas.flatMap(
    (a) => QUESTION_TEMPLATES[a.competency],
  );

  return {
    competencyAreas,
    relevantProjects,
    technicalTalkingPoints,
    productTalkingPoints,
    gaps,
    questionsToPrepare,
  };
}
