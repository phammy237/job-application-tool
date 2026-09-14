import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { optionalTrimmedText } from './contact';

/**
 * The interaction's medium, not its purpose — matches
 * supabase/migrations/0018_contact_interactions.sql's `interaction_type` CHECK exactly.
 * Deliberately excludes purpose-shaped values like THANK_YOU/REFERRAL_REQUEST/FOLLOW_UP
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6B" §4) — those describe *why* an interaction happened,
 * which belongs in `subject`/`notes`, not a second, conflicting axis on `interactionType`.
 */
export const contactInteractionTypeSchema = z.enum([
  'EMAIL',
  'CALL',
  'COFFEE_CHAT',
  'MEETING',
  'LINKEDIN_MESSAGE',
  'EVENT',
  'INTRODUCTION',
  'NOTE',
  'OTHER',
]);
export type ContactInteractionType = z.infer<typeof contactInteractionTypeSchema>;
export const CONTACT_INTERACTION_TYPES = contactInteractionTypeSchema.options;

/** Nullable — many interaction types (a coffee chat, a meeting, a standalone note) have no
 * natural direction and must never be forced to pick one. */
export const interactionDirectionSchema = z.enum(['INBOUND', 'OUTBOUND', 'MUTUAL']);
export type InteractionDirection = z.infer<typeof interactionDirectionSchema>;
export const INTERACTION_DIRECTIONS = interactionDirectionSchema.options;

/** Only MANUAL exists in Phase 6B — the user's own "Log interaction" form. A future
 * Gmail-derived source is added only once that feature actually ships (docs/IMPLEMENTATION_PLAN.md
 * "Phase 6B" §6), the same additive-widening posture as `contacts.source`. */
export const contactInteractionSourceSchema = z.enum(['MANUAL']);
export type ContactInteractionSource = z.infer<typeof contactInteractionSourceSchema>;

const MAX_SUBJECT_LENGTH = 200;
const MAX_NOTES_LENGTH = 10000;

/** Domain shape returned by packages/database — never the raw DB snake_case row. */
export const contactInteractionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  contactId: uuidSchema,
  interactionType: contactInteractionTypeSchema,
  direction: interactionDirectionSchema.nullable(),
  /** When the interaction actually happened — user-editable, not the row's creation time. */
  occurredAt: isoDateTimeSchema,
  subject: z.string().nullable(),
  notes: z.string().nullable(),
  /** Optional context linking this interaction to one of the user's applications — see
   * docs/DATA_MODEL.md "contact_interactions" for the ownership/deletion-semantics guarantees. */
  applicationId: uuidSchema.nullable(),
  source: contactInteractionSourceSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ContactInteraction = z.infer<typeof contactInteractionSchema>;

/**
 * `interactionType` and `occurredAt` are the only required fields — everything else is optional
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6B" §10). No `source` field: Phase 6B only ever creates
 * `MANUAL` interactions, so the query layer sets it, never the caller.
 */
export const createContactInteractionInputSchema = z.object({
  interactionType: contactInteractionTypeSchema,
  occurredAt: isoDateTimeSchema,
  direction: interactionDirectionSchema.nullable().optional(),
  subject: optionalTrimmedText(MAX_SUBJECT_LENGTH),
  notes: optionalTrimmedText(MAX_NOTES_LENGTH),
  applicationId: uuidSchema.nullable().optional(),
});
export type CreateContactInteractionInput = z.infer<
  typeof createContactInteractionInputSchema
>;

/** Same shape as creation, every field optional so a caller can send only what changed. */
export const updateContactInteractionInputSchema =
  createContactInteractionInputSchema.partial();
export type UpdateContactInteractionInput = z.infer<
  typeof updateContactInteractionInputSchema
>;
