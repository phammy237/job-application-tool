import { z } from 'zod';

/**
 * See docs/EXTENSION_DESIGN.md §6. This enum is a labeling vocabulary only — it does not by
 * itself enforce anything. The "DEMOGRAPHIC/LEGAL/AUTHENTICATION never suggested" rule is a
 * code-level rule (CLAUDE.md "Form-field classification is enforcement, not labeling"),
 * implemented in the popup/suggestion logic starting Phase 3, not in this schema. A value here
 * validating successfully says nothing about whether a suggestion may ever be generated for it.
 */
export const fieldClassificationSchema = z.enum([
  'BASIC_PROFILE',
  'EDUCATION',
  'EXPERIENCE',
  'SKILLS',
  'WORK_AUTHORIZATION',
  'RELOCATION',
  'COMPENSATION',
  'FREE_RESPONSE',
  'FILE_UPLOAD',
  'DEMOGRAPHIC',
  'LEGAL',
  'AUTHENTICATION',
  'UNKNOWN',
]);
export type FieldClassification = z.infer<typeof fieldClassificationSchema>;

/**
 * CLAUDE.md: "Fields classified DEMOGRAPHIC, LEGAL, or AUTHENTICATION never get a generated
 * suggestion, ever." Lives here (not in packages/ai, which the extension is banned from
 * importing — see apps/extension/.eslintrc.json) so both the server-side generation pipeline
 * (packages/ai/src/config.ts re-exports this) and the extension's popup (which must never even
 * offer to fetch a suggestion for one of these fields, not just rely on the backend refusing the
 * request) enforce the identical set from one source, not two that could drift.
 */
export const NEVER_SUGGEST_CLASSIFICATIONS: ReadonlySet<FieldClassification> = new Set([
  'DEMOGRAPHIC',
  'LEGAL',
  'AUTHENTICATION',
]);

/**
 * A single form field detected on a job application page by the extension's content script.
 * Lives only in the extension (popup state / chrome.storage.local) in Phase 2 — never sent to
 * or persisted by the backend, since nothing server-side consumes field data until Phase 3's
 * suggestion pipeline, whose shape isn't decided yet.
 *
 * `AUTHENTICATION` fields (password/login inputs) must never reach this schema at all — the
 * detector excludes them before classification, not after (CLAUDE.md: "never extract-then-
 * ignore"). A value with that classification here would mean the exclusion filter has a bug,
 * not that enforcement happened downstream.
 */
export const detectedFieldSchema = z.object({
  /** Stable per-analysis id (derived from a CSS selector / DOM path), not a live DOM reference
   * — this value must survive being serialized across the content-script/background/popup
   * message-passing boundary. */
  fieldId: z.string().min(1),
  label: z.string().nullable(),
  htmlName: z.string().nullable(),
  htmlId: z.string().nullable(),
  /** e.g. "text", "email", "tel", "select-one", "textarea", "file", "radio", "checkbox". */
  inputType: z.string(),
  classification: fieldClassificationSchema,
  confidence: z.number().min(0).max(1),
  selectOptions: z.array(z.string()).optional(),
  /**
   * Non-empty text already present in the field at detection time (trimmed), or null if it
   * reads as unfilled. Drives Phase 4's "Already completed" review state (never silently
   * overwrite a value the user already entered). Deliberately not captured for
   * checkbox/radio/file inputs — a single control's checked/empty state isn't a meaningful
   * "current value" snapshot the way text/select content is; see detect-fields.ts. Defaults to
   * null so every existing DetectedField literal built before this field existed still parses.
   */
  currentValue: z.string().nullable().default(null),
});
export type DetectedField = z.infer<typeof detectedFieldSchema>;
