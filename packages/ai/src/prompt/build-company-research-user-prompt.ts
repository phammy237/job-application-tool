import type {
  JobSnapshot,
  RequirementEvidenceMappingWithValidity,
} from '@career-os/shared';
import {
  COMPANY_RESEARCH_SOURCE_TEXT_CHAR_CAP,
  SNAPSHOT_DESCRIPTION_CHAR_CAP,
} from '../config';

export interface CompanyResearchSourceForPrompt {
  id: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  /** Already-extracted, already-capped page text (`select-company-research-sources.ts`'s
   * pipeline caller is responsible for the cap; this function re-truncates defensively too). */
  text: string;
}

export interface BuildCompanyResearchUserPromptParams {
  companyName: string;
  roleTitle: string;
  jobSnapshot: JobSnapshot | null;
  /** The CURRENT requirement-mapping run's mappings, if one exists — null (not an empty array)
   * when none exists at all, same "degrade honestly, never silently trigger Phase 5A" posture as
   * every other pipeline in this package that reuses requirement context. */
  currentMapping: RequirementEvidenceMappingWithValidity[] | null;
  sources: CompanyResearchSourceForPrompt[];
  /** Set on the retry attempt — see generate-company-research.ts's retry-once step. */
  retryReason?: string;
}

export interface CompanyResearchRequirementContext {
  id: string;
  text: string;
}

export interface BuildCompanyResearchUserPromptResult {
  userText: string;
  allowedSourceIds: Set<string>;
  requirementContext: CompanyResearchRequirementContext[];
  allowedRequirementIds: Set<string>;
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Same requirement-context-without-a-mapping fallback 7E's own user-prompt builder uses
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §5, reused here per "Phase 7G" §15/§43): when no
 * CURRENT requirement-mapping run exists, requirement ids are synthesized per-request directly
 * from the job snapshot's own qualification lists, so role relevance can still cite real
 * requirements. When there is no job snapshot at all (§43 — an application with no captured
 * posting can still be researched from company + role title alone), the requirement list is
 * simply empty — never invented.
 */
function buildRequirementContext(
  jobSnapshot: JobSnapshot | null,
  currentMapping: RequirementEvidenceMappingWithValidity[] | null,
): {
  requirementContext: CompanyResearchRequirementContext[];
  allowedRequirementIds: Set<string>;
} {
  const requirementContext: CompanyResearchRequirementContext[] = [];
  const allowedRequirementIds = new Set<string>();

  if (currentMapping && currentMapping.length > 0) {
    for (const mapping of currentMapping) {
      requirementContext.push({ id: mapping.id, text: mapping.requirementText });
      allowedRequirementIds.add(mapping.id);
    }
    return { requirementContext, allowedRequirementIds };
  }

  if (!jobSnapshot) {
    return { requirementContext, allowedRequirementIds };
  }

  jobSnapshot.requiredQualifications.forEach((text, i) => {
    const id = `required-${i}`;
    requirementContext.push({ id, text });
    allowedRequirementIds.add(id);
  });
  jobSnapshot.preferredQualifications.forEach((text, i) => {
    const id = `preferred-${i}`;
    requirementContext.push({ id, text });
    allowedRequirementIds.add(id);
  });

  return { requirementContext, allowedRequirementIds };
}

export function buildCompanyResearchUserPrompt(
  params: BuildCompanyResearchUserPromptParams,
): BuildCompanyResearchUserPromptResult {
  const { companyName, roleTitle, jobSnapshot, currentMapping, sources, retryReason } =
    params;

  const { requirementContext, allowedRequirementIds } = buildRequirementContext(
    jobSnapshot,
    currentMapping,
  );

  const parts = [`<job_context>\nCompany: ${companyName}\nRole: ${roleTitle}`];
  if (jobSnapshot?.description) {
    parts[0] += `\nRole description: ${truncate(jobSnapshot.description, SNAPSHOT_DESCRIPTION_CHAR_CAP)}`;
  }
  if (requirementContext.length > 0) {
    const requirementsJson = JSON.stringify(requirementContext);
    parts[0] += `\nRequirements (cite by id in "requirementIds" only when genuinely relevant):\n${requirementsJson}`;
  } else {
    parts[0] +=
      `\nNo parsed job requirements are available for this role — do not invent any` +
      ` "requirementIds"; leave that field empty on every finding.`;
  }
  parts[0] += '\n</job_context>';

  const allowedSourceIds = new Set<string>();
  for (const source of sources) {
    allowedSourceIds.add(source.id);
    const meta = [
      `title="${source.title.replace(/"/g, "'")}"`,
      source.publisher ? `publisher="${source.publisher.replace(/"/g, "'")}"` : null,
      source.publishedAt ? `published="${source.publishedAt}"` : 'published="unknown"',
    ]
      .filter(Boolean)
      .join(' ');
    const text = truncate(source.text, COMPANY_RESEARCH_SOURCE_TEXT_CHAR_CAP);
    parts.push(`<source id="${source.id}" ${meta}>\n${text}\n</source>`);
  }

  if (retryReason) {
    parts.push(
      `Your previous attempt was rejected: ${retryReason}. Every sourceId must be one that ` +
        `literally appears on a <source id="..."> tag above, and every requirementId (if any) ` +
        `must literally appear in <job_context>'s requirement list. Try again.`,
    );
  }

  return {
    userText: parts.join('\n\n'),
    allowedSourceIds,
    requirementContext,
    allowedRequirementIds,
  };
}
