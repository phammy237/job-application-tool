import { z } from 'zod';

/**
 * Resume Import's structured-extraction contract (migration 0034, Phase B of the
 * onboarding-path hardening pass, packages/ai/src/generate-resume-extraction.ts). Deliberately
 * shaped to map directly onto the EXISTING Candidate Profile input schemas
 * (experienceInputSchema/educationInputSchema/projectInputSchema/skillInputSchema/
 * profileUpdateSchema) — this is a review-time DTO, never a second candidate-facts data model.
 * Dates are carried as the raw text the résumé actually shows (`dateRangeText`) — never a
 * structured date the model invented; a deterministic normalizer (parseResumeDateText) attempts
 * a safe ISO conversion afterward, and only for unambiguous formats. `uncertain` is the model's
 * own self-report of "I'm not confident about this segmentation" (docs/AI_GROUNDING.md's
 * unsupportedClaims pattern, applied here to structural ambiguity rather than factual support) —
 * every uncertain item is still shown for review, never dropped or hidden.
 *
 * The single most important guarantee this contract exists to support is enforced OUTSIDE this
 * schema, in validate-resume-extraction-contract.ts: every bullet/title/company/school/name
 * string below must appear, verbatim (after whitespace normalization), in the original extracted
 * résumé text. A Zod schema can only constrain shape, not "is this actually in the source
 * document" — that's a code-level check against the real input, run after every model response.
 */

export const resumeExtractionPersonalSchema = z.object({
  fullName: z.string().max(200).nullable(),
  email: z.string().max(200).nullable(),
  phone: z.string().max(50).nullable(),
  location: z.string().max(200).nullable(),
  linkedin: z.string().max(500).nullable(),
  github: z.string().max(500).nullable(),
  portfolio: z.string().max(500).nullable(),
  website: z.string().max(500).nullable(),
});
export type ResumeExtractionPersonal = z.infer<typeof resumeExtractionPersonalSchema>;

export const resumeExtractionExperienceSchema = z.object({
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  location: z.string().max(200).nullable(),
  dateRangeText: z.string().max(100).nullable(),
  bullets: z.array(z.string().min(1).max(600)).max(20).default([]),
  uncertain: z.boolean().default(false),
});
export type ResumeExtractionExperience = z.infer<typeof resumeExtractionExperienceSchema>;

export const resumeExtractionEducationSchema = z.object({
  school: z.string().min(1).max(200),
  degree: z.string().max(200).nullable(),
  fieldOfStudy: z.string().max(200).nullable(),
  dateRangeText: z.string().max(100).nullable(),
  gpa: z.string().max(20).nullable(),
  uncertain: z.boolean().default(false),
});
export type ResumeExtractionEducation = z.infer<typeof resumeExtractionEducationSchema>;

export const resumeExtractionProjectSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(200).nullable(),
  dateRangeText: z.string().max(100).nullable(),
  url: z.string().max(500).nullable(),
  bullets: z.array(z.string().min(1).max(600)).max(20).default([]),
  uncertain: z.boolean().default(false),
});
export type ResumeExtractionProject = z.infer<typeof resumeExtractionProjectSchema>;

export const resumeExtractionSkillSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.string().max(100).nullable(),
});
export type ResumeExtractionSkill = z.infer<typeof resumeExtractionSkillSchema>;

export const resumeExtractionContractSchema = z.object({
  experience: z.array(resumeExtractionExperienceSchema).max(30).default([]),
  education: z.array(resumeExtractionEducationSchema).max(10).default([]),
  projects: z.array(resumeExtractionProjectSchema).max(20).default([]),
  skills: z.array(resumeExtractionSkillSchema).max(100).default([]),
});
export type ResumeExtractionContract = z.infer<typeof resumeExtractionContractSchema>;

/**
 * The full reviewable payload the analyze endpoint returns to the client — personal info is
 * extracted deterministically (regex, never AI — see parse-resume-contact-info.ts), so it's
 * assembled separately from the AI-structured sections above rather than living inside the
 * model's own contract.
 */
export const resumeExtractionResultSchema = z.object({
  personal: resumeExtractionPersonalSchema,
  experience: z.array(resumeExtractionExperienceSchema),
  education: z.array(resumeExtractionEducationSchema),
  projects: z.array(resumeExtractionProjectSchema),
  skills: z.array(resumeExtractionSkillSchema),
  /** Items the grounding check dropped because they weren't verbatim in the source text —
   * surfaced for transparency (never silently discarded from the user's awareness), never
   * offered for approval. */
  droppedCount: z.number().int().min(0).default(0),
});
export type ResumeExtractionResult = z.infer<typeof resumeExtractionResultSchema>;
