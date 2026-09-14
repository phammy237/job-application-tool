/**
 * Résumé display-name and filename conventions (docs/IMPLEMENTATION_PLAN.md "Phase 7A" §10).
 *
 * The product brief for this phase specified a literal example name ("My Pham's Resume --
 * Microsoft -- Product Manager Intern"). "My Pham" is this deployment's one real user's actual
 * name — baking it into a shared naming template would violate CLAUDE.md's multi-tenancy rule
 * ("Never hardcode a user... Every feature is built as if a hundred strangers already use it,
 * even while only one real user exists"), since every other Career OS user's tailored résumés
 * would end up literally labeled "My Pham's Resume -- ...". This implementation instead derives
 * the owner's name from their own `profiles.full_name` (already a real per-user field), falling
 * back to the generic, non-identifying "My Resume" when that's unset — same convention, same
 * `"{owner} -- {Company} -- {Role}"` shape, but honest for every user, not just one.
 */
export function buildTailoredResumeDisplayName(
  ownerFullName: string | null,
  company: string,
  role: string,
): string {
  const trimmedName = ownerFullName?.trim();
  const owner = trimmedName ? `${trimmedName}'s Resume` : 'My Resume';
  return `${owner} -- ${company} -- ${role}`;
}

/** Characters that are illegal (or awkward) in a filename on at least one major OS — backslash,
 * forward slash, colon, asterisk, question mark, double quote, angle brackets, pipe — plus every
 * ASCII control character. Deliberately narrow: ordinary punctuation (apostrophes, en/em dashes,
 * commas, ampersands, etc.) is meaningful and is never stripped. */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeResumeFileNameSegment(segment: string): string {
  return segment.replace(ILLEGAL_FILENAME_CHARS, '').trim();
}

/** Builds a filesystem-safe filename from a display name — the same string used for on-screen
 * display, sanitized, plus an extension. No global uniqueness is enforced or assumed here:
 * duplicate display names across applications are expected and fine (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7A" §31) — internal identity is always the version's UUID, not this string. */
export function buildResumeFileName(displayName: string, extension = 'pdf'): string {
  const safe = sanitizeResumeFileNameSegment(displayName);
  return `${safe}.${extension}`;
}
