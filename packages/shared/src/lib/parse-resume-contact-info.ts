import type { ResumeExtractionPersonal } from '../schemas/resume-extraction';

/**
 * Deterministic (zero-AI) contact-info extraction from raw résumé text — email/phone/links are
 * exact-pattern-matchable and an LLM adds fabrication risk with no reliability benefit for this
 * narrow task, so this codebase's existing "deterministic first" posture (docs/JOB_DISCOVERY.md
 * §14, applied here to Resume Import) extends to personal info too: none of it goes through
 * Claude. Every returned field is either a literal regex match against the source text or the
 * literal first non-empty line (the near-universal "name is the first line" résumé convention) —
 * never inferred, never guessed at from context.
 */
export function parseResumeContactInfo(text: string): ResumeExtractionPersonal {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text)?.[0] ?? null;

  // North American / loosely international phone formats — deliberately conservative (a false
  // negative just means the user fills it in manually during review; a false positive would
  // populate a wrong phone number, the worse failure mode).
  const phone =
    /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(text)?.[0]?.trim() ?? null;

  const linkedin = /https?:\/\/(?:www\.)?linkedin\.com\/[^\s,)]+/i.exec(text)?.[0] ?? null;
  const github = /https?:\/\/(?:www\.)?github\.com\/[^\s,)]+/i.exec(text)?.[0] ?? null;

  // A bare URL that isn't LinkedIn/GitHub and isn't the email's own domain — the closest
  // deterministic proxy for "portfolio/personal site" without guessing. Only the first match is
  // used; anything beyond that is left for the user to add manually during review.
  const genericUrls = text.match(/https?:\/\/[^\s,)]+/gi) ?? [];
  const portfolio =
    genericUrls.find(
      (url) => !/linkedin\.com|github\.com/i.test(url),
    ) ?? null;

  // Résumé header convention: the candidate's name is almost always the first non-empty line,
  // and is never a line that itself looks like an email/phone/URL (those belong further down the
  // header, not as the name itself).
  const nameCandidate = lines.find(
    (line) =>
      line.length > 0 &&
      line.length <= 100 &&
      !line.includes('@') &&
      !/https?:\/\//i.test(line) &&
      !/\d{3}.*\d{4}/.test(line),
  );

  return {
    fullName: nameCandidate ?? null,
    email,
    phone,
    // Deliberately left blank, not AI-guessed: a header location has no reliable deterministic
    // pattern (unlike email/phone/URLs), and guessing risks picking up a job's location instead
    // of the candidate's own — an honest blank for the user to fill in beats a wrong guess.
    location: null,
    linkedin,
    github,
    portfolio,
    website: null,
  };
}
