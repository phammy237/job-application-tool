import { z } from 'zod';
import { profileLinksSchema } from './profile';
import { uuidSchema } from './common';

/**
 * `StructuredResumeV1` (Phase 7C) — the canonical, editable résumé content model. Raw LaTeX is
 * never the factual representation: this structured object is what a user actually edits, what
 * a later AI-tailoring phase will read/diff, and what the deterministic renderer
 * (`packages/shared/src/lib/resume-latex-render.ts`) turns into LaTeX. `schemaVersion` is
 * embedded in the payload itself (independent of `resume_versions.snapshot_format`) so a future
 * `StructuredResumeV2` can be introduced without ever reinterpreting an existing v1 snapshot —
 * see migration 0022.
 */
export const RESUME_CONTENT_SCHEMA_VERSION = 1 as const;

/** A calendar month/year — deliberately not an ISO timestamp: a résumé date is presentation data
 * ("May 2025"), not an event that happened at a precise instant (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7C" §24). `month` nullable supports a year-only date ("2025"). */
export const resumeDateSchema = z.object({
  year: z.number().int().min(1950).max(2100),
  month: z.number().int().min(1).max(12).nullable(),
});
export type ResumeDate = z.infer<typeof resumeDateSchema>;

/** `end: null` with `isPresent: false` means "no end date given" (rare — usually just omit the
 * range's meaning changes, not blank-and-ongoing); `isPresent: true` means "Present," and `end`
 * is ignored/must be null in that case. Two independent optional facts, not conflated into one
 * nullable field that can't distinguish them. */
export const resumeDateRangeSchema = z
  .object({
    start: resumeDateSchema.nullable(),
    end: resumeDateSchema.nullable(),
    isPresent: z.boolean().default(false),
  })
  .refine((range) => !range.isPresent || range.end === null, {
    message: 'end must be null when isPresent is true',
  });
export type ResumeDateRange = z.infer<typeof resumeDateRangeSchema>;

/**
 * Whether a bullet's text is traceable back to an approved `candidate_facts` row, or was typed
 * directly by the user with no such backing (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §4). A
 * discriminated union, not an optional array, so `MANUAL` genuinely carries no `sourceFactIds` —
 * an empty array would ambiguously look like "grounded in zero facts." Phase 7C manual editing
 * never requires the `CANDIDATE_FACTS` variant; it exists so a later AI-tailoring phase (not this
 * one) has somewhere honest to record provenance when it eventually generates bullets itself.
 */
export const resumeBulletProvenanceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MANUAL') }),
  z.object({
    type: z.literal('CANDIDATE_FACTS'),
    sourceFactIds: z.array(uuidSchema).min(1),
  }),
]);
export type ResumeBulletProvenance = z.infer<typeof resumeBulletProvenanceSchema>;

/** A stable id, generated once when a bullet/entry is created and kept for its whole life —
 * editing text never changes it, duplicating an entry always generates a new one
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §11). Not required to be a UUID specifically (these are
 * JSON-blob identities, not database rows) — just unique within this document. */
export const resumeEntryIdSchema = z.string().min(1).max(100);
export type ResumeEntryId = z.infer<typeof resumeEntryIdSchema>;

export const resumeBulletSchema = z.object({
  id: resumeEntryIdSchema,
  text: z.string().trim().min(1).max(600),
  provenance: resumeBulletProvenanceSchema.default({ type: 'MANUAL' }),
});
export type ResumeBullet = z.infer<typeof resumeBulletSchema>;

export const resumeHeaderSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().email().nullable(),
  phone: z.string().max(50).nullable(),
  location: z.string().max(200).nullable(),
  links: profileLinksSchema.default({}),
});
export type ResumeHeader = z.infer<typeof resumeHeaderSchema>;

export const resumeEducationEntrySchema = z.object({
  id: resumeEntryIdSchema,
  institution: z.string().trim().min(1).max(200),
  degree: z.string().max(200).nullable(),
  fieldOfStudy: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  dateRange: resumeDateRangeSchema,
  gpa: z.string().max(20).nullable(),
  honors: z.array(z.string().min(1).max(200)).default([]),
  bullets: z.array(resumeBulletSchema).default([]),
});
export type ResumeEducationEntry = z.infer<typeof resumeEducationEntrySchema>;

export const resumeExperienceEntrySchema = z.object({
  id: resumeEntryIdSchema,
  organization: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  location: z.string().max(200).nullable(),
  dateRange: resumeDateRangeSchema,
  bullets: z.array(resumeBulletSchema).default([]),
});
export type ResumeExperienceEntry = z.infer<typeof resumeExperienceEntrySchema>;

export const resumeProjectEntrySchema = z.object({
  id: resumeEntryIdSchema,
  name: z.string().trim().min(1).max(200),
  role: z.string().max(200).nullable(),
  url: z.string().url().nullable(),
  dateRange: resumeDateRangeSchema,
  bullets: z.array(resumeBulletSchema).default([]),
});
export type ResumeProjectEntry = z.infer<typeof resumeProjectEntrySchema>;

export const resumeLeadershipEntrySchema = z.object({
  id: resumeEntryIdSchema,
  organization: z.string().trim().min(1).max(200),
  role: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  dateRange: resumeDateRangeSchema,
  bullets: z.array(resumeBulletSchema).default([]),
});
export type ResumeLeadershipEntry = z.infer<typeof resumeLeadershipEntrySchema>;

/** A named group of flat skill labels (e.g. `{label: "Languages", items: ["Python",
 * "TypeScript"]}`) rather than one flat array — mirrors the existing `skills.category` column so
 * a user whose current skills are already categorized doesn't lose that structure
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §25). */
export const resumeSkillGroupSchema = z.object({
  id: resumeEntryIdSchema,
  label: z.string().trim().min(1).max(100),
  items: z.array(z.string().trim().min(1).max(100)).default([]),
});
export type ResumeSkillGroup = z.infer<typeof resumeSkillGroupSchema>;

/**
 * An explicit, user-authored LaTeX override — the "Advanced" mode's manual render customization
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §14). When present, this literal string is the LaTeX
 * rendered for this document; when absent, LaTeX is generated deterministically from the
 * structured fields above. The structured fields remain the factual model either way — setting
 * or clearing this field never edits them, and editing them never silently clears this field (the
 * UI surfaces an explicit "reset override" action instead of doing it automatically).
 */
export const resumeRenderOverrideSchema = z.object({
  latex: z.string().min(1).max(50_000),
});
export type ResumeRenderOverride = z.infer<typeof resumeRenderOverrideSchema>;

export const structuredResumeV1Schema = z.object({
  schemaVersion: z.literal(RESUME_CONTENT_SCHEMA_VERSION),
  header: resumeHeaderSchema,
  education: z.array(resumeEducationEntrySchema).default([]),
  experience: z.array(resumeExperienceEntrySchema).default([]),
  projects: z.array(resumeProjectEntrySchema).default([]),
  leadership: z.array(resumeLeadershipEntrySchema).default([]),
  skills: z.array(resumeSkillGroupSchema).default([]),
  renderOverride: resumeRenderOverrideSchema.nullable().default(null),
});
export type StructuredResumeV1 = z.infer<typeof structuredResumeV1Schema>;

/** A blank starting document — used for "start blank" and as the base every other
 * initialization path (profile import, clone-from-master) fills in on top of
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §9: never hallucinate content, so the safe default is
 * genuinely empty, not a fake example resume). */
export function createEmptyStructuredResume(header: ResumeHeader): StructuredResumeV1 {
  return {
    schemaVersion: RESUME_CONTENT_SCHEMA_VERSION,
    header,
    education: [],
    experience: [],
    projects: [],
    leadership: [],
    skills: [],
    renderOverride: null,
  };
}

/** Generates a new stable entry/bullet id. `crypto.randomUUID()` is available in both the
 * browser and Node — this package is bundled into both the web app and the extension. */
export function createResumeEntryId(): string {
  return globalThis.crypto.randomUUID();
}
