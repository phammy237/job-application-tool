import type { ApprovedFactForGeneration } from '@career-os/database';
import {
  selectResumeTailoringResearchFindings,
  type CompanyResearchSnapshot,
  type JobSnapshot,
  type RequirementEvidenceMappingWithValidity,
  type StructuredResumeV1,
} from '@career-os/shared';
import {
  FACT_TEXT_CHAR_CAP,
  RESEARCH_TAILORING_MAX_FINDINGS,
  RESUME_BULLET_CHAR_CAP,
  SNAPSHOT_DESCRIPTION_CHAR_CAP,
} from '../config';

export interface BuildResumeTailoringUserPromptParams {
  snapshot: JobSnapshot;
  /** The CURRENT requirement-mapping run's mappings, if one exists — null (not an empty array)
   * when none exists at all, same "degrade honestly, never silently trigger Phase 5A" posture as
   * generate-interview-prep.ts. */
  currentMapping: RequirementEvidenceMappingWithValidity[] | null;
  baseResume: StructuredResumeV1;
  facts: ApprovedFactForGeneration[];
  /** Phase 7H — the one exact, already-resolved, already-compatibility-checked snapshot to fold
   * into this request, or null for `JOB_ONLY` (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §3/§25).
   * This function never re-resolves or re-validates ownership/compatibility itself — that already
   * happened in `resolveResumeTailoringResearchSnapshot` before this is called. */
  researchSnapshot: CompanyResearchSnapshot | null;
  /** Set on the retry attempt — see generate-resume-tailoring-plan.ts's retry-once step. */
  retryReason?: string;
}

/** One company-research finding's bounded, minimized context (§10) — never the finding's source
 * excerpts/URLs, never the whole snapshot. */
export interface ResumeTailoringResearchFindingContext {
  claim: string;
  roleRelevance: string | null;
  category: string;
}

/** One requirement offered to the model this request, regardless of whether it came from a real
 * mapping run or was synthesized from the job snapshot's own qualification lists. */
export interface ResumeTailoringRequirementContext {
  id: string;
  text: string;
}

export interface BuildResumeTailoringUserPromptResult {
  userText: string;
  allowedFactIds: Set<string>;
  factTextById: Map<string, string>;
  requirementContext: ResumeTailoringRequirementContext[];
  allowedRequirementIds: Set<string>;
  /**
   * Non-null only when a real Phase 5A mapping run was reused — maps a requirement id to whether
   * that mapping's own relationship is MISSING. Null in the fallback (no-mapping) case, so
   * coverage computation (packages/shared's computeResumeTailoringCoverage) knows to fall back to
   * "only what this plan actually cited," never inventing a covered/uncovered verdict Career OS
   * never actually analyzed (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §5/§25/§26).
   */
  mappingIsMissing: ReadonlyMap<string, boolean> | null;
  /** Phase 7H — every research-finding id actually placed in this request's prompt, scoped to the
   * one resolved snapshot. Empty for `JOB_ONLY` or when the snapshot contributed zero selected
   * findings. */
  allowedResearchFindingIds: Set<string>;
  /** Bounded, resolved finding context for the ids above — passed straight through to
   * `buildResumeTailoringOperationViews` for display resolution (§32), never re-fetched from the
   * snapshot later. */
  researchFindingsById: Map<string, ResumeTailoringResearchFindingContext>;
  /** How many findings were actually selected into the prompt (§22/§34) — always 0 when
   * `researchSnapshot` was null. */
  selectedResearchFindingCount: number;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

function buildJobSnapshotSection(snapshot: JobSnapshot): string {
  const lines = [
    `Title: ${snapshot.title}`,
    `Company: ${snapshot.company}`,
    snapshot.description
      ? `Description: ${truncate(snapshot.description, SNAPSHOT_DESCRIPTION_CHAR_CAP)}`
      : null,
    snapshot.requiredQualifications.length > 0
      ? `Required qualifications:\n${snapshot.requiredQualifications.map((q) => `- ${q}`).join('\n')}`
      : null,
    snapshot.preferredQualifications.length > 0
      ? `Preferred qualifications:\n${snapshot.preferredQualifications.map((q) => `- ${q}`).join('\n')}`
      : null,
    snapshot.responsibilities.length > 0
      ? `Responsibilities:\n${snapshot.responsibilities.map((r) => `- ${r}`).join('\n')}`
      : null,
    snapshot.skills.length > 0 ? `Skills: ${snapshot.skills.join(', ')}` : null,
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

/** Serializes the base résumé's structural ids and text — the only view of the résumé the model
 * ever sees. Deliberately omits header/contact info entirely: no operation type can touch it, so
 * there is nothing for the model to legitimately do with it, and omitting it is one less place a
 * prompt-injected résumé bullet could try to smuggle a false claim about contact details into a
 * response field. */
function serializeBaseResume(baseResume: StructuredResumeV1) {
  const bullet = (b: StructuredResumeV1['education'][number]['bullets'][number]) => ({
    id: b.id,
    text: truncate(b.text, RESUME_BULLET_CHAR_CAP),
  });
  return {
    education: baseResume.education.map((e) => ({
      id: e.id,
      institution: e.institution,
      degree: e.degree,
      fieldOfStudy: e.fieldOfStudy,
      bullets: e.bullets.map(bullet),
    })),
    experience: baseResume.experience.map((e) => ({
      id: e.id,
      organization: e.organization,
      role: e.role,
      bullets: e.bullets.map(bullet),
    })),
    projects: baseResume.projects.map((p) => ({
      id: p.id,
      name: p.name,
      bullets: p.bullets.map(bullet),
    })),
    leadership: baseResume.leadership.map((l) => ({
      id: l.id,
      organization: l.organization,
      role: l.role,
      bullets: l.bullets.map(bullet),
    })),
    skills: baseResume.skills.map((g) => ({ id: g.id, label: g.label, items: g.items })),
  };
}

/**
 * Serializes the bounded, selected subset of a company-research snapshot's findings (§10/§22) —
 * deliberately never the full snapshot: no source excerpts, no URLs, no unselected findings, no
 * other historical snapshot. `sourceTypes` is a light, aggregated provenance-quality signal (§10)
 * — e.g. `["OFFICIAL_NEWSROOM", "REPUTABLE_NEWS"]` — never the sources themselves.
 */
function buildCompanyResearchSection(
  snapshot: CompanyResearchSnapshot,
  selectedFindings: CompanyResearchSnapshot['findings'],
): string {
  const findingsJson = JSON.stringify(
    selectedFindings.map((finding) => ({
      id: finding.id,
      category: finding.category,
      claim: finding.claim,
      roleRelevance: finding.roleRelevance,
      requirementIds: finding.requirementIds,
      sourceTypes: [...new Set(finding.sources.map((source) => source.sourceType))],
    })),
  );
  return (
    `<company_research_snapshot id="${snapshot.id}">\n` +
    `This describes the COMPANY, researched ${snapshot.researchedAt} — never the candidate. Use ` +
    `it only to help decide what to emphasize among the candidate's REAL, already-cited ` +
    `experience; never as evidence of anything the candidate did.\n` +
    `${findingsJson}\n</company_research_snapshot>`
  );
}

export function buildResumeTailoringUserPrompt(
  params: BuildResumeTailoringUserPromptParams,
): BuildResumeTailoringUserPromptResult {
  const { snapshot, currentMapping, baseResume, facts, researchSnapshot, retryReason } = params;

  const factsJson = JSON.stringify(
    facts.map((fact) => ({
      id: fact.id,
      category: fact.category,
      text: truncate(fact.text, FACT_TEXT_CHAR_CAP),
    })),
  );
  const allowedFactIds = new Set(facts.map((fact) => fact.id));
  const factTextById = new Map(facts.map((fact) => [fact.id, fact.text]));

  const parts = [`<job_snapshot>\n${buildJobSnapshotSection(snapshot)}\n</job_snapshot>`];

  const requirementContext: ResumeTailoringRequirementContext[] = [];
  const allowedRequirementIds = new Set<string>();
  let mappingIsMissing: Map<string, boolean> | null = null;

  if (currentMapping && currentMapping.length > 0) {
    mappingIsMissing = new Map();
    const mappingJson = JSON.stringify(
      currentMapping.map((mapping) => {
        allowedRequirementIds.add(mapping.id);
        mappingIsMissing?.set(mapping.id, mapping.relationship === 'MISSING');
        requirementContext.push({ id: mapping.id, text: mapping.requirementText });
        return {
          id: mapping.id,
          requirementText: mapping.requirementText,
          requiredOrPreferred: mapping.requiredOrPreferred,
          relationship: mapping.relationship,
          matchedFactIds: mapping.matchedFacts.map((fact) => fact.factId),
        };
      }),
    );
    parts.push(`<requirement_mappings>\n${mappingJson}\n</requirement_mappings>`);
  } else {
    // Fallback (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §5) — this pipeline never triggers
    // requirement-mapping generation itself. Requirement ids are synthesized here, per request,
    // directly from the job snapshot's own qualification lists, so the model can still cite real
    // requirements and coverage can still be computed honestly from what was actually cited —
    // deliberately different from generate-interview-prep.ts's fallback (which leaves requirement
    // ids null/empty entirely), since Phase 7E's coverage model needs citable ids to exist even
    // without a mapping (§25/§26).
    snapshot.requiredQualifications.forEach((text, i) => {
      const id = `required-${i}`;
      requirementContext.push({ id, text });
      allowedRequirementIds.add(id);
    });
    snapshot.preferredQualifications.forEach((text, i) => {
      const id = `preferred-${i}`;
      requirementContext.push({ id, text });
      allowedRequirementIds.add(id);
    });
    const requirementsJson = JSON.stringify(requirementContext);
    parts.push(
      '<requirement_mappings>\nNo requirement-to-evidence analysis exists yet for this role. ' +
        `Grounding quality is reduced accordingly — use these requirement ids drawn directly from ` +
        `<job_snapshot> instead:\n${requirementsJson}\n</requirement_mappings>`,
    );
  }

  parts.push(`<base_resume>\n${JSON.stringify(serializeBaseResume(baseResume))}\n</base_resume>`);
  parts.push(`<candidate_facts>\n${factsJson}\n</candidate_facts>`);

  // Phase 7H (§3/§22/§25) — folded in only when a snapshot was actually resolved for this
  // request; ranked/bounded selection, never the snapshot's full finding list.
  const allowedResearchFindingIds = new Set<string>();
  const researchFindingsById = new Map<string, ResumeTailoringResearchFindingContext>();
  let selectedResearchFindingCount = 0;
  if (researchSnapshot) {
    const selectedFindings = selectResumeTailoringResearchFindings(
      researchSnapshot.findings,
      allowedRequirementIds,
      RESEARCH_TAILORING_MAX_FINDINGS,
    );
    selectedResearchFindingCount = selectedFindings.length;
    for (const finding of selectedFindings) {
      allowedResearchFindingIds.add(finding.id);
      researchFindingsById.set(finding.id, {
        claim: finding.claim,
        roleRelevance: finding.roleRelevance,
        category: finding.category,
      });
    }
    if (selectedFindings.length > 0) {
      parts.push(buildCompanyResearchSection(researchSnapshot, selectedFindings));
    }
  }

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. Every bulletId/entryId/` +
        `skillGroupId must come from <base_resume>, every sourceFactIds entry must come from ` +
        `<candidate_facts>, every requirementIds entry must come from <requirement_mappings>, ` +
        `and every researchFindingIds entry (if any) must come from ` +
        `<company_research_snapshot> — no others, and no invented numbers or technologies beyond ` +
        `what the cited bullet/facts already say. Try again.`,
    );
  }

  return {
    userText: parts.join('\n\n'),
    allowedFactIds,
    factTextById,
    requirementContext,
    allowedRequirementIds,
    mappingIsMissing,
    allowedResearchFindingIds,
    researchFindingsById,
    selectedResearchFindingCount,
  };
}
