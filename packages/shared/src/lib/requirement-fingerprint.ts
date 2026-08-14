/**
 * Dedup key for requirement rows within one mapping-generation run (docs/IMPLEMENTATION_PLAN.md
 * Phase 5A round-4 addendum §6) — not a stored, cross-time identity like the job-snapshot
 * fingerprint, so no version prefix or JSON envelope is warranted; this is just a normalized-text
 * hash used once, at contract-validation time, to reject a model response containing the same
 * requirement twice before it ever reaches the database. Case is preserved (same reasoning as the
 * job-snapshot fingerprint) — only Unicode canonical form and inconsequential whitespace are
 * normalized.
 */
export async function computeRequirementFingerprint(requirementText: string): Promise<string> {
  const normalized = requirementText.normalize('NFC').replace(/\s+/g, ' ').trim();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
