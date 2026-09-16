/**
 * Exact per-field caps applied during sanitization, before fingerprinting or storage — truncation,
 * never rejection (docs/IMPLEMENTATION_PLAN.md Phase 5A round-4 addendum §5/§8). Exported so the
 * Zod schema, the AI prompt builder, and this file's own sanitizer share one source of truth and
 * can never drift apart.
 */
export const JOB_SNAPSHOT_CAPS = {
  company: 200,
  title: 300,
  location: 200,
  employmentType: 100,
  sourceUrl: 2048,
  externalId: 200,
  description: 20_000,
  qualificationArrayLength: 60,
  qualificationItemLength: 500,
  locationsArrayLength: 20,
  locationItemLength: 200,
  salaryCurrency: 10,
  remoteLocationRestrictions: 1000,
  workAuthorizationLanguage: 2000,
} as const;

export interface JobSnapshotSanitizableInput {
  company: string;
  title: string;
  location: string | null;
  employmentType: string | null;
  sourceUrl: string | null;
  externalId: string | null;
  description: string | null;
  requiredQualifications: string[];
  preferredQualifications: string[];
  responsibilities: string[];
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  locations: string[];
  workMode: 'REMOTE' | 'HYBRID' | 'ONSITE' | null;
  remoteLocationRestrictions: string | null;
  workAuthorizationLanguage: string | null;
  /** ASHBY added for D6 (docs/JOB_DISCOVERY.md "Discovery/application domain distinction") —
   * discovery-originated snapshots are the first real writer of this field to see an
   * Ashby-sourced job; every other existing writer (the extension) never produces it, so this is
   * purely additive. */
  sourceType: 'GENERIC' | 'GREENHOUSE' | 'LEVER' | 'WORKDAY' | 'ASHBY' | null;
}

export interface SanitizedJobSnapshotContent {
  company: string;
  title: string;
  location: string | null;
  employmentType: string | null;
  sourceUrl: string | null;
  externalId: string | null;
  description: string | null;
  requiredQualifications: string[];
  preferredQualifications: string[];
  responsibilities: string[];
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  locations: string[];
  workMode: 'REMOTE' | 'HYBRID' | 'ONSITE' | null;
  remoteLocationRestrictions: string | null;
  workAuthorizationLanguage: string | null;
  /** ASHBY added for D6 (docs/JOB_DISCOVERY.md "Discovery/application domain distinction") —
   * discovery-originated snapshots are the first real writer of this field to see an
   * Ashby-sourced job; every other existing writer (the extension) never produces it, so this is
   * purely additive. */
  sourceType: 'GENERIC' | 'GREENHOUSE' | 'LEVER' | 'WORKDAY' | 'ASHBY' | null;
}

export interface JobSnapshotSanitizeResult {
  sanitized: SanitizedJobSnapshotContent;
  contentTruncated: boolean;
  truncatedFields: string[];
}

/**
 * Collapses inconsequential whitespace (never any other content change — no case folding, per
 * docs/IMPLEMENTATION_PLAN.md's round-4 fingerprint correction: case is meaningful for language
 * names, acronyms, product names, legal wording, "US" vs "us") and trims.
 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeScalar(
  value: string | null,
  cap: number,
  fieldName: string,
  truncatedFields: string[],
): string | null {
  if (value === null) return null;
  const collapsed = collapseWhitespace(value);
  if (collapsed.length > cap) {
    truncatedFields.push(fieldName);
    return collapsed.slice(0, cap);
  }
  return collapsed;
}

function sanitizeArray(
  values: string[],
  maxLength: number,
  itemCap: number,
  fieldName: string,
  truncatedFields: string[],
): string[] {
  let truncated = false;
  const items = values.slice(0, maxLength).map((item) => {
    const collapsed = collapseWhitespace(item);
    if (collapsed.length > itemCap) {
      truncated = true;
      return collapsed.slice(0, itemCap);
    }
    return collapsed;
  });
  if (values.length > maxLength) truncated = true;
  if (truncated) truncatedFields.push(fieldName);
  return items;
}

/** Sanitizes + caps raw job-extraction content into the exact shape stored on job_snapshots. */
export function sanitizeJobSnapshotInput(input: JobSnapshotSanitizableInput): JobSnapshotSanitizeResult {
  const truncatedFields: string[] = [];
  const caps = JOB_SNAPSHOT_CAPS;

  const sanitized: SanitizedJobSnapshotContent = {
    company: sanitizeScalar(input.company, caps.company, 'company', truncatedFields) ?? '',
    title: sanitizeScalar(input.title, caps.title, 'title', truncatedFields) ?? '',
    location: sanitizeScalar(input.location, caps.location, 'location', truncatedFields),
    employmentType: sanitizeScalar(
      input.employmentType,
      caps.employmentType,
      'employmentType',
      truncatedFields,
    ),
    sourceUrl: sanitizeScalar(input.sourceUrl, caps.sourceUrl, 'sourceUrl', truncatedFields),
    externalId: sanitizeScalar(input.externalId, caps.externalId, 'externalId', truncatedFields),
    description: sanitizeScalar(input.description, caps.description, 'description', truncatedFields),
    requiredQualifications: sanitizeArray(
      input.requiredQualifications,
      caps.qualificationArrayLength,
      caps.qualificationItemLength,
      'requiredQualifications',
      truncatedFields,
    ),
    preferredQualifications: sanitizeArray(
      input.preferredQualifications,
      caps.qualificationArrayLength,
      caps.qualificationItemLength,
      'preferredQualifications',
      truncatedFields,
    ),
    responsibilities: sanitizeArray(
      input.responsibilities,
      caps.qualificationArrayLength,
      caps.qualificationItemLength,
      'responsibilities',
      truncatedFields,
    ),
    skills: sanitizeArray(
      input.skills,
      caps.qualificationArrayLength,
      caps.qualificationItemLength,
      'skills',
      truncatedFields,
    ),
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    salaryCurrency: sanitizeScalar(
      input.salaryCurrency,
      caps.salaryCurrency,
      'salaryCurrency',
      truncatedFields,
    ),
    locations: sanitizeArray(
      input.locations,
      caps.locationsArrayLength,
      caps.locationItemLength,
      'locations',
      truncatedFields,
    ),
    workMode: input.workMode,
    remoteLocationRestrictions: sanitizeScalar(
      input.remoteLocationRestrictions,
      caps.remoteLocationRestrictions,
      'remoteLocationRestrictions',
      truncatedFields,
    ),
    workAuthorizationLanguage: sanitizeScalar(
      input.workAuthorizationLanguage,
      caps.workAuthorizationLanguage,
      'workAuthorizationLanguage',
      truncatedFields,
    ),
    sourceType: input.sourceType,
  };

  return { sanitized, contentTruncated: truncatedFields.length > 0, truncatedFields };
}

/**
 * Canonical, deterministic fingerprint of everything that is stored, immutable snapshot
 * *content* — every field that could otherwise go stale if excluded and the fingerprint reused
 * an older row (docs/IMPLEMENTATION_PLAN.md's round-4 correction: sourceUrl/externalId are
 * included, not treated as inert provenance, for exactly this reason). Excludes id/user_id/
 * source_job_id (lineage, not content), content_fingerprint itself, and captured_at/created_at
 * (timestamps). Case is preserved; only Unicode canonical form and inconsequential whitespace are
 * normalized. null and "" are distinct (JSON null vs an empty string). Array order is preserved,
 * not sorted. A fixed key order + JSON.stringify is the canonical serialization — SHA-256 of its
 * UTF-8 bytes, hex-encoded, prefixed "v1:" so a future normalization change (bumped to "v2:") can
 * never collide with an old row's fingerprint.
 */
export async function computeJobSnapshotFingerprint(
  content: SanitizedJobSnapshotContent,
  truncation: { contentTruncated: boolean; truncatedFields: string[] },
): Promise<string> {
  const normalize = (value: string | null): string | null =>
    value === null ? null : collapseWhitespace(value.normalize('NFC'));
  const normalizeArray = (values: string[]): string[] =>
    values.map((value) => collapseWhitespace(value.normalize('NFC')));

  const canonical = {
    company: normalize(content.company),
    title: normalize(content.title),
    location: normalize(content.location),
    employmentType: normalize(content.employmentType),
    sourceUrl: normalize(content.sourceUrl),
    externalId: normalize(content.externalId),
    description: normalize(content.description),
    requiredQualifications: normalizeArray(content.requiredQualifications),
    preferredQualifications: normalizeArray(content.preferredQualifications),
    responsibilities: normalizeArray(content.responsibilities),
    skills: normalizeArray(content.skills),
    salaryMin: content.salaryMin,
    salaryMax: content.salaryMax,
    salaryCurrency: normalize(content.salaryCurrency),
    locations: normalizeArray(content.locations),
    workMode: content.workMode,
    remoteLocationRestrictions: normalize(content.remoteLocationRestrictions),
    workAuthorizationLanguage: normalize(content.workAuthorizationLanguage),
    sourceType: content.sourceType,
    contentTruncated: truncation.contentTruncated,
    truncatedFields: [...truncation.truncatedFields].sort(),
  };

  return `v1:${await sha256Hex(JSON.stringify(canonical))}`;
}

/**
 * Web Crypto (`crypto.subtle`), not `node:crypto` — this package is bundled into the extension
 * (apps/extension, Vite) as well as the server (apps/web, Node), and `node:crypto` has no browser
 * equivalent. `crypto.subtle.digest` is available in Node 19+ globally and in every modern
 * browser/extension context, at the cost of being async rather than sync.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
