/**
 * Deterministic content fingerprint for a `job_catalog` row (docs/JOB_DISCOVERY.md "Content
 * hash"), following the same canonical-JSON + SHA-256 pattern as `job-snapshot-fingerprint.ts`.
 *
 * Hashes only meaningful posting content — company, title, location, workplace/employment type,
 * description, responsibilities, qualifications, salary, and apply URL. Deliberately excludes
 * last_seen_at/crawl timestamps/database ids/created_at/updated_at: the same logical posting
 * fetched twice must produce the same hash, and a meaningful content change must change it.
 *
 * Case is preserved (only Unicode canonical form and inconsequential whitespace are normalized) —
 * same reasoning as job-snapshot-fingerprint.ts: case can be meaningful (product names,
 * acronyms). Prefixed "v1:" so a future normalization change can never collide with an old hash.
 */
export interface JobCatalogHashableContent {
  companyName: string;
  title: string;
  locationText: string | null;
  workplaceType: 'REMOTE' | 'HYBRID' | 'ONSITE' | null;
  employmentType: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  applyUrl: string;
}

export async function computeJobCatalogContentHash(
  content: JobCatalogHashableContent,
): Promise<string> {
  const normalize = (value: string | null): string | null =>
    value === null ? null : value.normalize('NFC').replace(/\s+/g, ' ').trim();

  const canonical = {
    companyName: normalize(content.companyName),
    title: normalize(content.title),
    locationText: normalize(content.locationText),
    workplaceType: content.workplaceType,
    employmentType: normalize(content.employmentType),
    description: normalize(content.description),
    responsibilities: normalize(content.responsibilities),
    qualifications: normalize(content.qualifications),
    salaryMin: content.salaryMin,
    salaryMax: content.salaryMax,
    salaryCurrency: normalize(content.salaryCurrency),
    applyUrl: normalize(content.applyUrl),
  };

  return `v1:${await sha256Hex(JSON.stringify(canonical))}`;
}

/**
 * Web Crypto (`crypto.subtle`), not `node:crypto` — this package is bundled into the extension
 * (Vite) as well as the server/CLI (Node), matching job-snapshot-fingerprint.ts's own reasoning.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
