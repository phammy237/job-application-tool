import type { NormalizedWorkplaceType } from '../schemas/job-role-taxonomy';
import { containsPhrase } from './phrase-matcher';

/**
 * Normalizes work mode for D4 scoring (docs/JOB_DISCOVERY.md "Work mode normalization").
 *
 * 1. The structured `job_catalog.workplace_type` value (already REMOTE/HYBRID/ONSITE from the
 *    D1-D3 adapter, when the provider supplies it) always wins when present.
 * 2. Only when that's null does this fall back to a conservative phrase scan of `locationText`
 *    ALONE — never the full description, which is far noisier and more likely to produce a false
 *    positive ("occasional remote-friendly travel" in an onsite role, etc.).
 * 3. ONSITE is NEVER inferred merely from the absence of a "remote"/"hybrid" phrase — that would
 *    silently convert "we don't know" into an assumption. No signal at all -> UNKNOWN.
 */
export function normalizeWorkplaceType(
  structuredWorkplaceType: 'REMOTE' | 'HYBRID' | 'ONSITE' | null,
  locationText: string | null,
): NormalizedWorkplaceType {
  if (structuredWorkplaceType) return structuredWorkplaceType;

  if (locationText) {
    if (containsPhrase(locationText, 'remote')) return 'REMOTE';
    if (containsPhrase(locationText, 'hybrid')) return 'HYBRID';
  }

  return 'UNKNOWN';
}
