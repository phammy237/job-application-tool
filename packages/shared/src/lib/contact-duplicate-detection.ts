import type { Contact, PossibleDuplicateContact } from '../schemas/contact';

/**
 * Deterministic contact duplicate detection (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §12) —
 * advisory only. Nothing in this file ever merges, blocks, or silently reuses an existing
 * contact; it only tells a caller which existing contacts look like they might already be this
 * person, and why, so the UI can warn before creating a second row for someone who already
 * exists.
 */

/** Trims and lowercases; returns null for anything blank so an empty string never "matches"
 * another empty string. */
export function normalizeContactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalizes a LinkedIn profile URL enough to treat obvious equivalents the same: scheme
 * differences (http vs https), a leading `www.`, a trailing slash, and any query string or
 * fragment (LinkedIn profile links commonly carry tracking params). Deliberately not a general
 * URL-equivalence engine — just the handful of variations that actually show up when two people
 * paste the "same" profile link differently.
 *
 * Falls back to a plain trimmed/lowercased string comparison when the input doesn't parse as a
 * URL at all (e.g. pasted without a scheme, like `linkedin.com/in/jane`) — safe use of `URL`
 * parsing where it applies, without needing a full parser for the rest.
 */
export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return trimmed.toLowerCase();
    }
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let path = parsed.pathname.toLowerCase();
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return `${host}${path}`;
}

const COMPANY_SUFFIX_RE =
  /\s*[,.]?\s*\b(inc|incorporated|llc|l\.l\.c|corp|corporation|co|ltd|limited)\b\.?\s*$/i;

/** Collapses whitespace, lowercases, and strips one trailing legal-entity suffix (", Inc.",
 * " LLC", etc.) — conservative on purpose, just enough that "Acme Inc." and "Acme" line up. */
function normalizeNameOrCompany(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(COMPANY_SUFFIX_RE, '')
    .trim()
    .toLowerCase();
}

export function normalizeContactDisplayName(displayName: string | null | undefined): string {
  return normalizeNameOrCompany(displayName);
}

export function normalizeContactCompany(company: string | null | undefined): string {
  return normalizeNameOrCompany(company);
}

export interface DuplicateCandidateInput {
  displayName: string | null | undefined;
  email: string | null | undefined;
  linkedinUrl: string | null | undefined;
  currentCompany: string | null | undefined;
}

/**
 * Checks one candidate contact-in-progress against a user's existing contacts and returns every
 * existing contact that looks like it might already be the same person, each with exactly one
 * reason (priority: email match, then LinkedIn match, then name+company match — a contact
 * matching on more than one signal is still reported once, under its strongest reason).
 *
 * `excludeContactId` lets editing an existing contact run this same check against every *other*
 * contact without the contact always "duplicating itself" (docs/IMPLEMENTATION_PLAN.md "Phase
 * 6A" §17).
 */
export function findPossibleDuplicateContacts(
  candidate: DuplicateCandidateInput,
  existingContacts: Contact[],
  excludeContactId?: string,
): PossibleDuplicateContact[] {
  const candidateEmail = normalizeContactEmail(candidate.email);
  const candidateLinkedIn = normalizeLinkedInUrl(candidate.linkedinUrl);
  const candidateName = normalizeContactDisplayName(candidate.displayName);
  const candidateCompany = normalizeContactCompany(candidate.currentCompany);
  const canCheckNameCompany = candidateName.length > 0 && candidateCompany.length > 0;

  const results: PossibleDuplicateContact[] = [];

  for (const existing of existingContacts) {
    if (excludeContactId && existing.id === excludeContactId) continue;

    if (candidateEmail && normalizeContactEmail(existing.email) === candidateEmail) {
      results.push({ contact: existing, reason: 'EMAIL_MATCH' });
      continue;
    }

    if (
      candidateLinkedIn &&
      normalizeLinkedInUrl(existing.linkedinUrl) === candidateLinkedIn
    ) {
      results.push({ contact: existing, reason: 'LINKEDIN_MATCH' });
      continue;
    }

    if (
      canCheckNameCompany &&
      normalizeContactDisplayName(existing.displayName) === candidateName &&
      normalizeContactCompany(existing.currentCompany) === candidateCompany
    ) {
      results.push({ contact: existing, reason: 'NAME_COMPANY_MATCH' });
    }
  }

  return results;
}
