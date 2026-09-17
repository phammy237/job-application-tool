import {
  resumeExtractionContractSchema,
  type ResumeExtractionContract,
  type ResumeExtractionEducation,
  type ResumeExtractionExperience,
  type ResumeExtractionProject,
  type ResumeExtractionSkill,
} from '@career-os/shared';

export type ResumeExtractionContractValidationResult =
  | { status: 'ok'; result: ResumeExtractionContract; droppedCount: number }
  | { status: 'rejected'; reason: 'validation_failed' };

/** Whitespace/case-insensitive comparison — PDF text extraction routinely reflows line breaks
 * differently than the model's own copy of the same text, so an exact byte-for-byte match would
 * reject legitimate verbatim bullets. Never loosens beyond whitespace/case: still requires every
 * word, in order, to actually appear in the source. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isGrounded(candidate: string, normalizedSourceText: string): boolean {
  const normalizedCandidate = normalize(candidate);
  return normalizedCandidate.length > 0 && normalizedSourceText.includes(normalizedCandidate);
}

/**
 * The authoritative no-fabrication gate (docs/AI_GROUNDING.md's `unsupportedClaims` pattern,
 * applied here as a code-level verbatim check rather than a self-report — a resume-extraction
 * response has no analogous "cite an approved fact id" mechanism to check against, so this
 * checks the one thing that actually matters: does the text the model returned really appear in
 * the résumé it was given. Runs AFTER Zod shape validation, independent of it — a
 * schema-conformant but fabricated entry is still rejected here.
 *
 * Per-field policy: an experience/education/project entry's own identifying text (company/
 * title/school/project name) must be grounded or the WHOLE entry is dropped (an ungrounded
 * company name means the whole entry is untrustworthy, not just cosmetically wrong); an
 * individual bullet that isn't grounded is dropped on its own, keeping the rest of an otherwise
 * real entry (one fabricated bullet shouldn't hide an otherwise-real job).
 */
export function validateResumeExtractionContract(
  rawText: string,
  sourceResumeText: string,
): ResumeExtractionContractValidationResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const parsed = resumeExtractionContractSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'validation_failed' };
  }

  const normalizedSource = normalize(sourceResumeText);
  let droppedCount = 0;

  const experience: ResumeExtractionExperience[] = [];
  for (const entry of parsed.data.experience) {
    if (!isGrounded(entry.company, normalizedSource) || !isGrounded(entry.title, normalizedSource)) {
      droppedCount += 1;
      continue;
    }
    const groundedBullets = entry.bullets.filter((bullet) => isGrounded(bullet, normalizedSource));
    droppedCount += entry.bullets.length - groundedBullets.length;
    experience.push({ ...entry, bullets: groundedBullets });
  }

  const education: ResumeExtractionEducation[] = [];
  for (const entry of parsed.data.education) {
    if (!isGrounded(entry.school, normalizedSource)) {
      droppedCount += 1;
      continue;
    }
    education.push(entry);
  }

  const projects: ResumeExtractionProject[] = [];
  for (const entry of parsed.data.projects) {
    if (!isGrounded(entry.name, normalizedSource)) {
      droppedCount += 1;
      continue;
    }
    const groundedBullets = entry.bullets.filter((bullet) => isGrounded(bullet, normalizedSource));
    droppedCount += entry.bullets.length - groundedBullets.length;
    projects.push({ ...entry, bullets: groundedBullets });
  }

  const skills: ResumeExtractionSkill[] = [];
  for (const entry of parsed.data.skills) {
    if (!isGrounded(entry.name, normalizedSource)) {
      droppedCount += 1;
      continue;
    }
    skills.push(entry);
  }

  return {
    status: 'ok',
    result: { experience, education, projects, skills },
    droppedCount,
  };
}
