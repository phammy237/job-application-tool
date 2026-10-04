import {
  COMPETENCIES,
  myosStoryInputSchema,
  uuidSchema,
  type Competency,
  type EvidenceGraphData,
  type MyosEvidence,
  type MyosStory,
  type MyosStoryInput,
} from '@career-os/shared';
import { z } from 'zod';

export function competencyLabel(c: string): string {
  return c
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface ParsedStoryForm {
  input: Omit<MyosStoryInput, 'verificationState'>;
  projectIds: string[];
  experienceIds: string[];
  evidenceIds: string[];
}

export type StoryFormParseResult =
  { ok: true; value: ParsedStoryForm } | { ok: false; message: string };

function text(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function ids(fd: FormData, key: string): string[] {
  return [...new Set(fd.getAll(key).filter((v): v is string => typeof v === 'string'))];
}

/**
 * FormData -> validated story. Competencies are a multi-value checkbox group restricted to the
 * 11 COMPETENCIES; themes are comma-separated. `verificationState` is deliberately NOT read from
 * the form (a user cannot upgrade an AI/inferred story by posting a field).
 */
export function parseStoryForm(fd: FormData): StoryFormParseResult {
  const themes = (text(fd, 'themes') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const parsed = myosStoryInputSchema.omit({ verificationState: true }).safeParse({
    title: text(fd, 'title') ?? '',
    situation: text(fd, 'situation'),
    task: text(fd, 'task'),
    action: text(fd, 'action'),
    result: text(fd, 'result'),
    competencies: fd.getAll('competencies'),
    themes: [...new Set(themes)],
    userApproved: fd.get('userApproved') === 'on',
    visibility: text(fd, 'visibility') ?? 'PRIVATE',
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message:
        issue?.path[0] === 'title'
          ? 'Give the story a title.'
          : (issue?.message ?? 'Invalid story.'),
    };
  }
  const uuidList = z.array(uuidSchema);
  const projectIds = uuidList.safeParse(ids(fd, 'projectIds'));
  const experienceIds = uuidList.safeParse(ids(fd, 'experienceIds'));
  const evidenceIds = uuidList.safeParse(ids(fd, 'evidenceIds'));
  if (!projectIds.success || !experienceIds.success || !evidenceIds.success) {
    return { ok: false, message: 'One of the linked items is invalid.' };
  }
  return {
    ok: true,
    value: {
      input: parsed.data,
      projectIds: projectIds.data,
      experienceIds: experienceIds.data,
      evidenceIds: evidenceIds.data,
    },
  };
}

export interface StoryFilter {
  competency: Competency | null;
  approvedOnly: boolean;
}

export function parseStoryFilter(
  sp: Record<string, string | string[] | undefined>,
): StoryFilter {
  const raw = Array.isArray(sp.competency) ? sp.competency[0] : sp.competency;
  const approved = Array.isArray(sp.approved) ? sp.approved[0] : sp.approved;
  return {
    competency: (COMPETENCIES as readonly string[]).includes(raw ?? '')
      ? (raw as Competency)
      : null,
    approvedOnly: approved === '1',
  };
}

export function filterStories(
  stories: readonly MyosStory[],
  filter: StoryFilter,
): MyosStory[] {
  return stories.filter(
    (s) =>
      (!filter.competency || s.competencies.includes(filter.competency)) &&
      (!filter.approvedOnly || s.userApproved),
  );
}

export interface CompetencyCoverageItem {
  competency: Competency;
  approvedCount: number;
  totalCount: number;
}

/** Per-competency story counts. "Covered" means at least one APPROVED story. */
export function competencyCoverage(
  stories: readonly MyosStory[],
): CompetencyCoverageItem[] {
  return COMPETENCIES.map((competency) => {
    const tagged = stories.filter((s) => s.competencies.includes(competency));
    return {
      competency,
      approvedCount: tagged.filter((s) => s.userApproved).length,
      totalCount: tagged.length,
    };
  });
}

export function isFlaggedUnconfirmed(
  story: Pick<MyosStory, 'verificationState'>,
): boolean {
  return (
    story.verificationState === 'AI_GENERATED' || story.verificationState === 'INFERRED'
  );
}

export interface StoryLinks {
  projects: Array<{ id: string; name: string }>;
  experiences: Array<{ id: string; name: string }>;
  evidence: MyosEvidence[];
}

/** Entities a story REFERENCES (or evidence that SUPPORTS it). */
export function storyLinks(
  graph: Pick<EvidenceGraphData, 'edges' | 'projects' | 'experiences' | 'evidence'>,
  storyId: string,
): StoryLinks {
  const projects = new Map(graph.projects.map((p) => [p.id, p.name]));
  const experiences = new Map(
    graph.experiences.map((e) => [e.id, `${e.title} at ${e.company}`]),
  );
  const evidence = new Map(graph.evidence.map((e) => [e.id, e]));
  const out: StoryLinks = { projects: [], experiences: [], evidence: [] };
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    let otherType: string;
    let otherId: string;
    if (
      edge.fromType === 'STORY' &&
      edge.fromId === storyId &&
      edge.relation === 'REFERENCES'
    ) {
      otherType = edge.toType;
      otherId = edge.toId;
    } else if (
      edge.toType === 'STORY' &&
      edge.toId === storyId &&
      edge.fromType === 'EVIDENCE' &&
      edge.relation === 'SUPPORTS'
    ) {
      otherType = 'EVIDENCE';
      otherId = edge.fromId;
    } else continue;
    const key = `${otherType}:${otherId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (otherType === 'PROJECT' && projects.has(otherId)) {
      out.projects.push({ id: otherId, name: projects.get(otherId)! });
    } else if (otherType === 'EXPERIENCE' && experiences.has(otherId)) {
      out.experiences.push({ id: otherId, name: experiences.get(otherId)! });
    } else if (otherType === 'EVIDENCE' && evidence.has(otherId)) {
      out.evidence.push(evidence.get(otherId)!);
    }
  }
  out.projects.sort((a, b) => a.name.localeCompare(b.name));
  out.experiences.sort((a, b) => a.name.localeCompare(b.name));
  out.evidence.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export const STAR_PROMPTS = [
  {
    label: 'Situation',
    prompt: 'What was the context? Where, when, and what was at stake?',
  },
  { label: 'Task', prompt: 'What were you specifically responsible for?' },
  { label: 'Action', prompt: 'What did you do, step by step? Use "I", not "we".' },
  {
    label: 'Result',
    prompt: 'What changed? Include a number only if you can back it up.',
  },
] as const;
