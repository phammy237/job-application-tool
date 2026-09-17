import { RESUME_EXTRACTION_TEXT_CHAR_CAP } from '../config';

/**
 * Builds the one user-turn message for résumé structuring — just the extracted text, tagged as
 * untrusted data (see the system prompt's own doc comment), capped to bound worst-case prompt
 * size the same way every other pipeline's injected content is capped
 * (RESUME_EXTRACTION_TEXT_CHAR_CAP, packages/ai/src/config.ts). Truncation happens at a line
 * boundary where possible so a cut-off résumé doesn't end mid-word.
 */
export function buildResumeExtractionUserPrompt(resumeText: string): string {
  const capped =
    resumeText.length <= RESUME_EXTRACTION_TEXT_CHAR_CAP
      ? resumeText
      : resumeText.slice(0, RESUME_EXTRACTION_TEXT_CHAR_CAP);

  return `<resume_text>\n${capped}\n</resume_text>\n\nStructure this résumé's text per your instructions.`;
}
