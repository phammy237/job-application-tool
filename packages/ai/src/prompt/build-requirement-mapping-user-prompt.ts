import type { JobSnapshot } from '@career-os/shared';
import { FACT_TEXT_CHAR_CAP, SNAPSHOT_DESCRIPTION_CHAR_CAP } from '../config';
import type { ApprovedFactForGeneration } from '@career-os/database';

export interface BuildRequirementMappingUserPromptParams {
  snapshot: JobSnapshot;
  facts: ApprovedFactForGeneration[];
  /** Set on the retry attempt — see generate-requirement-mapping.ts's retry-once step. */
  retryReason?: string;
}

export interface BuildRequirementMappingUserPromptResult {
  userText: string;
  allowedFactIds: Set<string>;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * The full sanitized snapshot representation — not just description — since a posting's
 * requirements are often spread across qualifications/responsibilities/skills too
 * (docs/IMPLEMENTATION_PLAN.md round-4 addendum §7). Everything here was already sanitized and
 * capped at storage time (packages/shared's JOB_SNAPSHOT_CAPS); SNAPSHOT_DESCRIPTION_CHAR_CAP is
 * a second, prompt-specific bound, never larger than what's actually stored.
 */
function buildJobSnapshotSection(snapshot: JobSnapshot): string {
  const lines = [
    `Title: ${snapshot.title}`,
    `Company: ${snapshot.company}`,
    snapshot.employmentType ? `Employment type: ${snapshot.employmentType}` : null,
    snapshot.locations.length > 0 ? `Locations: ${snapshot.locations.join(', ')}` : null,
    snapshot.workMode ? `Work mode: ${snapshot.workMode}` : null,
    snapshot.remoteLocationRestrictions
      ? `Remote location restrictions: ${snapshot.remoteLocationRestrictions}`
      : null,
    snapshot.workAuthorizationLanguage
      ? `Work authorization language: ${snapshot.workAuthorizationLanguage}`
      : null,
    snapshot.description ? `Description: ${truncate(snapshot.description, SNAPSHOT_DESCRIPTION_CHAR_CAP)}` : null,
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

export function buildRequirementMappingUserPrompt(
  params: BuildRequirementMappingUserPromptParams,
): BuildRequirementMappingUserPromptResult {
  const { snapshot, facts, retryReason } = params;

  const factsJson = JSON.stringify(
    facts.map((fact) => ({
      id: fact.id,
      category: fact.category,
      text: truncate(fact.text, FACT_TEXT_CHAR_CAP),
    })),
  );

  const allowedFactIds = new Set(facts.map((fact) => fact.id));

  const parts = [
    `<job_snapshot>\n${buildJobSnapshotSection(snapshot)}\n</job_snapshot>`,
    `<candidate_facts>\n${factsJson}\n</candidate_facts>`,
  ];

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. Every id in "matchedFactIds" must ` +
        `come from the ids listed in <candidate_facts> above — no others. Try again.`,
    );
  }

  return { userText: parts.join('\n\n'), allowedFactIds };
}
