import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * How a contact row came to exist. Matches supabase/migrations/0017_networking_contacts.sql's
 * `contacts.source` CHECK exactly — only values Phase 6A can actually produce. MANUAL is the
 * /network "Add contact" form; APPLICATION_CONTEXT is added from an application's People
 * section (docs/IMPLEMENTATION_PLAN.md "Phase 6A"). Gmail-derived contacts get their own value
 * only once that feature actually ships (Phase 6B+) — do not add it speculatively here.
 */
export const contactSourceSchema = z.enum(['MANUAL', 'APPLICATION_CONTEXT', 'OTHER']);
export type ContactSource = z.infer<typeof contactSourceSchema>;
export const CONTACT_SOURCES = contactSourceSchema.options;

/**
 * Longer-lived relationship classification — how this person relates to the user overall, not
 * their function on any one application (that's `applicationContactRoleSchema` below). Multiple
 * tags per contact are supported. See docs/IMPLEMENTATION_PLAN.md "Phase 6A" §5/§21 for why this
 * is deliberately not the same taxonomy as application roles.
 */
export const contactTagSchema = z.enum([
  'RECRUITER',
  'HIRING_MANAGER',
  'EMPLOYEE',
  'ALUMNI',
  'MENTOR',
  'PROFESSOR',
  'FRIEND',
  'CLASSMATE',
  'REFERRER',
  'NETWORKING_CONTACT',
  'OTHER',
]);
export type ContactTag = z.infer<typeof contactTagSchema>;
export const CONTACT_TAGS = contactTagSchema.options;

/**
 * The person's function relative to one specific application — distinct from `contactTagSchema`
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §21). Linking a contact with role INTERVIEWER never
 * mutates their global tags, and vice versa.
 */
export const applicationContactRoleSchema = z.enum([
  'RECRUITER',
  'HIRING_MANAGER',
  'REFERRER',
  'INTERVIEWER',
  'EMPLOYEE_CONTACT',
  'OTHER',
]);
export type ApplicationContactRole = z.infer<typeof applicationContactRoleSchema>;
export const APPLICATION_CONTACT_ROLES = applicationContactRoleSchema.options;

const MAX_SHORT_TEXT = 200;
const MAX_NOTES = 10000;

/** Domain shape returned by packages/database — never the raw DB snake_case row. */
export const contactSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  displayName: z.string().min(1),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  currentCompany: z.string().nullable(),
  currentTitle: z.string().nullable(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  source: contactSourceSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Contact = z.infer<typeof contactSchema>;

/**
 * Trims a plain text field and normalizes an empty result to null — every optional identity
 * field on the create/update inputs below shares this, so "" from a form submit doesn't become
 * a stored empty string sitting alongside genuinely-null. Exported for reuse by other Phase 6
 * input schemas (e.g. `contact-interaction.ts`'s `subject`/`notes`) that want the identical
 * trim-and-nullify behavior rather than a second, subtly different implementation.
 */
export function optionalTrimmedText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
}

/**
 * Only `displayName` is required — a contact like "Jane — UF alum at Microsoft" must be valid
 * with nothing else filled in (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §3). `email` is validated
 * as a real email only when non-empty; malformed input is rejected rather than silently dropped
 * so the UI can show a real validation error.
 */
export const createContactInputSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(MAX_SHORT_TEXT),
  firstName: optionalTrimmedText(MAX_SHORT_TEXT),
  lastName: optionalTrimmedText(MAX_SHORT_TEXT),
  email: z
    .string()
    .trim()
    .email('Enter a valid email')
    .max(MAX_SHORT_TEXT)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  phone: optionalTrimmedText(MAX_SHORT_TEXT),
  linkedinUrl: optionalTrimmedText(MAX_SHORT_TEXT),
  currentCompany: optionalTrimmedText(MAX_SHORT_TEXT),
  currentTitle: optionalTrimmedText(MAX_SHORT_TEXT),
  location: optionalTrimmedText(MAX_SHORT_TEXT),
  notes: optionalTrimmedText(MAX_NOTES),
  source: contactSourceSchema.default('MANUAL'),
  tags: z.array(contactTagSchema).default([]),
});
export type CreateContactInput = z.infer<typeof createContactInputSchema>;

/** Same shape as creation, minus `source` (a contact's origin never changes after creation) and
 * with every field optional so a caller can send only what changed. */
export const updateContactInputSchema = createContactInputSchema
  .omit({ source: true })
  .partial();
export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;

export const applicationContactSchema = z.object({
  applicationId: uuidSchema,
  contactId: uuidSchema,
  role: applicationContactRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type ApplicationContact = z.infer<typeof applicationContactSchema>;

/** Why a candidate was flagged during duplicate detection — advisory only, never auto-merged
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §12). */
export const possibleDuplicateReasonSchema = z.enum([
  'EMAIL_MATCH',
  'LINKEDIN_MATCH',
  'NAME_COMPANY_MATCH',
]);
export type PossibleDuplicateReason = z.infer<typeof possibleDuplicateReasonSchema>;

export const possibleDuplicateContactSchema = z.object({
  contact: contactSchema,
  reason: possibleDuplicateReasonSchema,
});
export type PossibleDuplicateContact = z.infer<typeof possibleDuplicateContactSchema>;
