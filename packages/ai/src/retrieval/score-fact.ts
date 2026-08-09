import type { ApprovedFactForGeneration } from '@career-os/database';
import type { FieldClassification, Job } from '@career-os/shared';
import { extractKeywords } from './tokenize';

/** Only the job fields scoring actually reads — callers can pass a full Job. */
export type ScorableJob = Pick<
  Job,
  'title' | 'description' | 'responsibilities' | 'qualifications' | 'preferredQualifications' | 'skills'
>;

const RECENCY_DECAY_MONTHS = 60;

/**
 * fieldClassification -> the fact category/sourceTable values considered "on topic" for that
 * field. Classifications not listed here (BASIC_PROFILE, FREE_RESPONSE, COMPENSATION,
 * FILE_UPLOAD, UNKNOWN) have no category bias — every fact scores the flat neutral value.
 */
const CATEGORY_AFFINITY: Partial<Record<FieldClassification, ReadonlySet<string>>> = {
  EXPERIENCE: new Set(['experiences', 'EXPERIENCE', 'LEADERSHIP', 'RESEARCH']),
  EDUCATION: new Set(['education', 'EDUCATION']),
  SKILLS: new Set(['skills', 'SKILL', 'LANGUAGE', 'CERTIFICATION']),
  WORK_AUTHORIZATION: new Set(['WORK_AUTHORIZATION']),
  RELOCATION: new Set(['RELOCATION_PREFERENCE', 'LOCATION_PREFERENCE']),
};

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  );
}

function keywordOverlapScore(factTokens: Set<string>, jobKeywords: Set<string>): number {
  let shared = 0;
  for (const token of factTokens) {
    if (jobKeywords.has(token)) shared += 1;
  }
  return Math.min(1, shared / 6);
}

function skillMatchScore(
  factTokens: Set<string>,
  factTags: string[],
  jobSkills: Set<string>,
): number {
  const factSignal = new Set([...factTokens, ...factTags.map((tag) => tag.toLowerCase())]);
  let shared = 0;
  for (const skill of jobSkills) {
    if (factSignal.has(skill)) shared += 1;
  }
  return Math.min(1, shared / 3);
}

function categoryMatchScore(
  fieldClassification: FieldClassification,
  fact: ApprovedFactForGeneration,
): number {
  const affinity = CATEGORY_AFFINITY[fieldClassification];
  if (!affinity) return 0.5;
  const onTopic = affinity.has(fact.sourceTable) || (fact.category !== null && affinity.has(fact.category));
  return onTopic ? 1.0 : 0.3;
}

function recencyScore(fact: ApprovedFactForGeneration, now: Date): number {
  if (fact.isOngoing) return 1.0;
  if (!fact.recencyDate) return 0.5;
  const monthsSince = monthsBetween(new Date(fact.recencyDate), now);
  return Math.max(0, Math.min(1, 1 - monthsSince / RECENCY_DECAY_MONTHS));
}

/**
 * Deterministic weighted score in [0, 1] for how relevant one approved fact is to one job +
 * field. Pure function — `now` is always injected, never read from Date.now() internally, so
 * rank-facts.ts's determinism test (call twice, expect identical output) actually proves
 * something. See docs/AI_GROUNDING.md §2 step 4 and the Phase 3 plan's retrieval design.
 */
export function scoreFact(
  job: ScorableJob,
  fieldClassification: FieldClassification,
  fact: ApprovedFactForGeneration,
  now: Date,
): number {
  const jobText = [
    job.title,
    job.description,
    ...job.responsibilities,
    ...job.qualifications,
    ...job.preferredQualifications,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const jobKeywords = extractKeywords(jobText);
  const jobSkills = new Set(job.skills.map((skill) => skill.toLowerCase()));
  const factTokens = extractKeywords(fact.text);

  const overlap = keywordOverlapScore(factTokens, jobKeywords);
  const skillMatch = skillMatchScore(factTokens, fact.tags, jobSkills);
  const category = categoryMatchScore(fieldClassification, fact);
  const recency = recencyScore(fact, now);

  return 0.5 * overlap + 0.2 * skillMatch + 0.15 * category + 0.15 * recency;
}
