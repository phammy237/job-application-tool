/**
 * Best-effort, purely deterministic extraction of a company name and job title from a Gmail
 * message's own sender/subject — never a Claude call, never invented (CLAUDE.md's "never invent
 * a fact" extends here: this directly becomes a persisted `applications.company`/`title`, with
 * no user review before it's written, unlike every other AI-touched field in this codebase). A
 * wrong-but-plausible-looking guess here is worse than refusing — see extractApplicationIdentity's
 * own doc comment for the concrete refusal rule.
 */

export interface ExtractedApplicationIdentity {
  company: string;
  title: string;
}

/** Shown verbatim in the UI when a title can't be confidently extracted — honest about the gap
 * rather than guessing, same pattern as this codebase's existing "Workplace unknown"/"Employment
 * type unknown" labels (apps/web's discovery-display-labels.ts). */
export const UNDETECTED_TITLE_PLACEHOLDER = 'Role not detected — edit this';

/** Role/HR-related words ATS systems commonly append to a sender display name (e.g. "Acme
 * Careers", "Acme Talent Acquisition Team") — stripped so the extracted company name reads as
 * just the company. Deliberately narrow and literal, never a fuzzy/legal-suffix strip (unlike
 * normalize-company-name.ts's dedupe-matching normalization): this is building a display value
 * a user will read, not a comparison key, so a real company whose name happens to contain one of
 * these words (e.g. "Recruiting.com") is an accepted, rare miss, not something worth risking a
 * false strip on a common case for. */
const SENDER_NAME_ROLE_WORDS =
  /\b(careers?|talent(\s+acquisition)?|recruiting|recruitment|hiring|human\s+resources|\bhr\b|jobs?|team|notifications?|no[-\s]?reply)\b/gi;

/**
 * Pulls the display name out of a raw "From" header — "Acme Careers <careers@acme.com>" -> "Acme
 * Careers" — and refuses (returns null) for a bare address with no display name at all
 * ("careers@acme.com") or anything that still looks like a raw address after stripping. A
 * missing display name is common (plenty of real ATS senders set none) and is treated as "we
 * don't have a confident company name," never papered over with the domain instead — many ATS
 * sending domains (greenhouse.io, lever.co, myworkday.com, …) are the *vendor's* name, not the
 * employer's, so falling back to the domain would frequently extract the wrong company entirely.
 */
export function extractCompanyName(message: { sender: string | null }): string | null {
  if (!message.sender) return null;

  const displayNameMatch = /^"?([^"<]+?)"?\s*</.exec(message.sender);
  const displayName = displayNameMatch?.[1]?.trim();
  if (!displayName || displayName.includes('@')) return null;

  const cleaned = displayName.replace(SENDER_NAME_ROLE_WORDS, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * A small, high-precision set of common ATS subject-line phrasings — "Your application for
 * Backend Engineer", "Application for the Backend Engineer position", "Re: Backend Engineer
 * application". Deliberately narrow: a pattern that doesn't match falls through to
 * UNDETECTED_TITLE_PLACEHOLDER rather than attempting an open-ended, failure-prone parse of
 * arbitrary subject text.
 */
const TITLE_PATTERNS = [
  /application (?:for|to)\s+(?:the\s+)?(.+?)(?:\s+(?:position|role))?(?:\s+at\s+.+)?$/i,
  /\byour\s+(.+?)\s+application\b/i,
  // Anchored to the start of the subject — this is the email "Re:" reply prefix, never a
  // mid-word match (e.g. the "re" inside "reaching"), which an unanchored version of this
  // pattern would otherwise happily — and wrongly — capture everything between.
  /^re:?\s*(.+?)\s+application\b/i,
];

const MAX_EXTRACTED_TITLE_LENGTH = 100;

export function extractJobTitle(subject: string | null): string | null {
  if (!subject) return null;
  for (const pattern of TITLE_PATTERNS) {
    const captured = pattern.exec(subject)?.[1]?.trim();
    if (captured && captured.length > 0 && captured.length <= MAX_EXTRACTED_TITLE_LENGTH) {
      return captured;
    }
  }
  return null;
}

/**
 * The combined, all-or-nothing extraction background-sync auto-creation actually uses: refuses
 * entirely (returns null — no application gets auto-created) when no company name can be
 * confidently extracted, since `applications.company` is NOT NULL and there is no honest
 * placeholder for "we don't know who this is from" the way there is for a title. A missing
 * title alone never blocks creation — it degrades to UNDETECTED_TITLE_PLACEHOLDER instead,
 * since the user can always fill that in once the application exists, same as any other field.
 */
export function extractApplicationIdentity(message: {
  sender: string | null;
  subject: string | null;
}): ExtractedApplicationIdentity | null {
  const company = extractCompanyName(message);
  if (!company) return null;
  return { company, title: extractJobTitle(message.subject) ?? UNDETECTED_TITLE_PLACEHOLDER };
}
