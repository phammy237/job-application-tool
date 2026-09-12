import type { ApprovedFactForGeneration } from '@career-os/database';
import type {
  JobSnapshot,
  RequirementEvidenceMappingWithValidity,
} from '@career-os/shared';
import { FACT_TEXT_CHAR_CAP, SNAPSHOT_DESCRIPTION_CHAR_CAP } from '../config';

export interface BuildInterviewPrepUserPromptParams {
  snapshot: JobSnapshot;
  /** The CURRENT requirement-mapping run's mappings, if one exists — null (not an empty array)
   * when none exists at all, so the prompt can say so honestly rather than silently omitting the
   * section (see generate-interview-prep.ts's own "degrade, don't silently run Phase 5A" step). */
  currentMapping: RequirementEvidenceMappingWithValidity[] | null;
  facts: ApprovedFactForGeneration[];
  /** Set on the retry attempt — see generate-interview-prep.ts's retry-once step. */
  retryReason?: string;
}

export interface BuildInterviewPrepUserPromptResult {
  userText: string;
  allowedFactIds: Set<string>;
  allowedRequirementIds: Set<string>;
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

export function buildInterviewPrepUserPrompt(
  params: BuildInterviewPrepUserPromptParams,
): BuildInterviewPrepUserPromptResult {
  const { snapshot, currentMapping, facts, retryReason } = params;

  const factsJson = JSON.stringify(
    facts.map((fact) => ({
      id: fact.id,
      category: fact.category,
      text: truncate(fact.text, FACT_TEXT_CHAR_CAP),
    })),
  );
  const allowedFactIds = new Set(facts.map((fact) => fact.id));

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

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. Every sourceFactIds entry must come ` +
        `from the ids listed in <candidate_facts>, and every sourceRequirementId/` +
        `sourceRequirementIds entry must come from the ids listed in <requirement_mappings> (or be ` +
        `null/empty if that section has none) — no others. Try again.`,
    );
  }

  return { userText: parts.join('\n\n'), allowedFactIds, allowedRequirementIds };
}
