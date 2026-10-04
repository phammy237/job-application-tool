import { extractRequirementsFromText, type RequirementInput } from '@career-os/shared';

export type RequirementSource =
  'ANALYSIS_RUN' | 'POSTING_LISTS' | 'EXTRACTED_FROM_TEXT' | 'NONE';

export interface ResolvedRequirements {
  source: RequirementSource;
  requirements: RequirementInput[];
}

interface MappingLike {
  requirementText: string;
  requiredOrPreferred: 'REQUIRED' | 'PREFERRED';
}

interface SnapshotLike {
  description: string | null;
  requiredQualifications: string[];
  preferredQualifications: string[];
}

const MAX_REQUIREMENTS = 25;
const MAX_LENGTH = 300;

function toInputs(
  items: { text: string; category?: 'REQUIRED' | 'PREFERRED' }[],
): RequirementInput[] {
  const seen = new Set<string>();
  const out: RequirementInput[] = [];
  for (const item of items) {
    const text = item.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
    if (text.length < 3) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= MAX_REQUIREMENTS) break;
    out.push({
      id: `req-${out.length + 1}`,
      text,
      ...(item.category ? { category: item.category } : {}),
    });
  }
  return out;
}

/**
 * Where the requirements for the deterministic evidence match come from, in priority order:
 *  1. the CURRENT requirement-mapping run (the same requirement list the AI analysis panel shows),
 *  2. the job snapshot's structured required/preferred qualification lists,
 *  3. deterministic extraction from the snapshot's description text.
 * Never calls an LLM.
 */
export function resolveApplicationRequirements(input: {
  mappings: MappingLike[] | null;
  snapshot: SnapshotLike | null;
}): ResolvedRequirements {
  if (input.mappings && input.mappings.length > 0) {
    return {
      source: 'ANALYSIS_RUN',
      requirements: toInputs(
        input.mappings.map((m) => ({
          text: m.requirementText,
          category: m.requiredOrPreferred,
        })),
      ),
    };
  }
  const snap = input.snapshot;
  if (snap) {
    const listed = toInputs([
      ...snap.requiredQualifications.map((text) => ({
        text,
        category: 'REQUIRED' as const,
      })),
      ...snap.preferredQualifications.map((text) => ({
        text,
        category: 'PREFERRED' as const,
      })),
    ]);
    if (listed.length > 0) return { source: 'POSTING_LISTS', requirements: listed };
    if (snap.description && snap.description.trim().length > 0) {
      const extracted = extractRequirementsFromText(snap.description);
      if (extracted.length > 0)
        return { source: 'EXTRACTED_FROM_TEXT', requirements: extracted };
    }
  }
  return { source: 'NONE', requirements: [] };
}
