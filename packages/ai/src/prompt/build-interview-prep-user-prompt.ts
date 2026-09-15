import type { ApprovedFactForGeneration } from '@career-os/database';
import {
  selectRelevantResearchFindings,
  type CompanyResearchSnapshot,
  type JobSnapshot,
  type RequirementEvidenceMappingWithValidity,
} from '@career-os/shared';
import {
  FACT_TEXT_CHAR_CAP,
  RESEARCH_TAILORING_MAX_FINDINGS,
  SNAPSHOT_DESCRIPTION_CHAR_CAP,
} from '../config';

export interface BuildInterviewPrepUserPromptParams {
  snapshot: JobSnapshot;
  /** The CURRENT requirement-mapping run's mappings, if one exists — null (not an empty array)
   * when none exists at all, so the prompt can say so honestly rather than silently omitting the
   * section (see generate-interview-prep.ts's own "degrade, don't silently run Phase 5A" step). */
  currentMapping: RequirementEvidenceMappingWithValidity[] | null;
  facts: ApprovedFactForGeneration[];
  /** Phase 7I — the one exact, already-resolved, already-compatibility-checked snapshot to fold
   * into this request, or null for `JOB_ONLY` (docs/IMPLEMENTATION_PLAN.md "Phase 7I"). This
   * function never re-resolves or re-validates ownership/compatibility itself — that already
   * happened in `resolveCompanyResearchSnapshotForRequest` before this is called. */
  researchSnapshot: CompanyResearchSnapshot | null;
  /** Set on the retry attempt — see generate-interview-prep.ts's retry-once step. */
  retryReason?: string;
}

/** One company-research finding's bounded, minimized context — never the finding's source
 * excerpts/URLs, never the whole snapshot. Mirrors résumé tailoring's own prompt context exactly
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7H"). */
export interface InterviewPrepResearchFindingContext {
  claim: string;
  roleRelevance: string | null;
  category: string;
}

export interface BuildInterviewPrepUserPromptResult {
  userText: string;
  allowedFactIds: Set<string>;
  factTextById: Map<string, string>;
  allowedRequirementIds: Set<string>;
  /** Phase 7I — every research-finding id actually placed in this request's prompt, scoped to
   * the one resolved snapshot. Empty for `JOB_ONLY` or when the snapshot contributed zero
   * selected findings. */
  allowedResearchFindingIds: Set<string>;
  /** Bounded, resolved finding context for the ids above — passed straight through to the
   * response resolver for display resolution, never re-fetched from the snapshot later. */
  researchFindingsById: Map<string, InterviewPrepResearchFindingContext>;
  /** How many findings were actually selected into the prompt — always 0 when `researchSnapshot`
   * was null. */
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

/** Serializes the bounded, selected subset of a company-research snapshot's findings — same
 * shape/rationale as résumé tailoring's own `buildCompanyResearchSection` (docs/
 * IMPLEMENTATION_PLAN.md "Phase 7H" §10/§22): no source excerpts, no URLs, no unselected
 * findings, no other historical snapshot. */
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
    `it only to help decide what to prepare for and what is currently relevant; never as evidence ` +
    `of anything the candidate did.\n` +
    `${findingsJson}\n</company_research_snapshot>`
  );
}

export function buildInterviewPrepUserPrompt(
  params: BuildInterviewPrepUserPromptParams,
): BuildInterviewPrepUserPromptResult {
  const { snapshot, currentMapping, facts, researchSnapshot, retryReason } = params;

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

  const allowedRequirementIds = new Set<string>();
  if (currentMapping && currentMapping.length > 0) {
    const mappingJson = JSON.stringify(
      currentMapping.map((mapping) => {
        allowedRequirementIds.add(mapping.id);
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
    parts.push(
      '<requirement_mappings>\nNo requirement-to-evidence analysis exists yet for this role — ' +
        'derive rolePriorities/gapsToPrepare directly from <job_snapshot> instead, and leave every ' +
        'sourceRequirementId/sourceRequirementIds null or empty.\n</requirement_mappings>',
    );
  }

  parts.push(`<candidate_facts>\n${factsJson}\n</candidate_facts>`);

  // Phase 7I — folded in only when a snapshot was actually resolved for this request; ranked/
  // bounded selection (reusing Phase 7H's own ranking function), never the snapshot's full
  // finding list.
  const allowedResearchFindingIds = new Set<string>();
  const researchFindingsById = new Map<string, InterviewPrepResearchFindingContext>();
  let selectedResearchFindingCount = 0;
  if (researchSnapshot) {
    const selectedFindings = selectRelevantResearchFindings(
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
      `Your previous attempt was rejected: ${retryReason}. Every sourceFactIds entry must come ` +
        `from the ids listed in <candidate_facts>, every sourceRequirementId/` +
        `sourceRequirementIds entry must come from the ids listed in <requirement_mappings> (or be ` +
        `null/empty if that section has none), and every researchFindingIds entry (if any) must ` +
        `come from <company_research_snapshot> — no others, and no invented numbers or ` +
        `technologies beyond what the cited facts already say. Try again.`,
    );
  }

  return {
    userText: parts.join('\n\n'),
    allowedFactIds,
    factTextById,
    allowedRequirementIds,
    allowedResearchFindingIds,
    researchFindingsById,
    selectedResearchFindingCount,
  };
}
