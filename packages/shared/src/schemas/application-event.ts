import { z } from 'zod';
import { applicationStatusSchema } from './application';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * DISCOVERY_HANDOFF added for D6 (docs/JOB_DISCOVERY.md "Application-event behavior") — the one
 * meaningful state transition D6 records ("discovered opportunity -> tracked application"), never
 * a noisy per-interaction stream (no "viewed", "clicked details", "opened external URL" events).
 * Fired exactly once per application on first creation from discovery, and again (with no
 * STATUS_CHANGE alongside it) the one time an existing extension-created application gets
 * retroactively linked to its catalog source — never on a repeat/idempotent handoff call.
 */
export const applicationEventTypeSchema = z.enum([
  'STATUS_CHANGE',
  'NOTE',
  'EMAIL_MATCHED',
  'MANUAL_EDIT',
  'DISCOVERY_HANDOFF',
]);
export type ApplicationEventType = z.infer<typeof applicationEventTypeSchema>;

export const applicationEventSourceSchema = z.enum(['USER', 'GMAIL_SYNC', 'SYSTEM']);
export type ApplicationEventSource = z.infer<typeof applicationEventSourceSchema>;

/**
 * DISCOVERY_HANDOFF's own `metadata` payload (docs/JOB_DISCOVERY.md "Match/Coverage/Eligibility
 * treatment") — durable provenance only, never anything that could drive application lifecycle
 * behavior on its own: `matchScore`/`coverage`/`eligibilityStatus` here are a historical snapshot
 * of what discovery showed at the moment of handoff, not a live or authoritative value anything
 * reads back to make a decision. Deliberately excludes the full eligibility check breakdown, the
 * posting description, or any other large payload — bounded server-side to 4000 characters as
 * text (migration 0032's `application_events_metadata_bounded` check), matched here by capping
 * every optional string field.
 */
export const discoveryHandoffEventMetadataSchema = z.object({
  jobCatalogId: uuidSchema,
  // JOBRIGHT_GITHUB added for D7 — Jobright-sourced handoffs are the first writer to see it, every
  // other existing writer never produces it, so this is purely additive (same precedent as ASHBY's
  // own D6 addition here).
  sourceType: z.enum(['GREENHOUSE', 'LEVER', 'ASHBY', 'JOBRIGHT_GITHUB']).nullable(),
  matchScore: z.number().min(0).max(100).nullable(),
  coverage: z.number().min(0).max(100).nullable(),
  eligibilityStatus: z.enum(['ELIGIBLE', 'UNKNOWN', 'CONFLICT']).nullable(),
  rankingVersion: z.string().max(100).nullable(),
  featureVersion: z.string().max(100).nullable(),
  eligibilityVersion: z.string().max(100).nullable(),
});
export type DiscoveryHandoffEventMetadata = z.infer<typeof discoveryHandoffEventMetadataSchema>;

export const applicationEventSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  applicationId: uuidSchema,
  eventType: applicationEventTypeSchema,
  fromStatus: applicationStatusSchema.nullable(),
  toStatus: applicationStatusSchema.nullable(),
  source: applicationEventSourceSchema,
  emailSignalId: uuidSchema.nullable(),
  /** Present only on DISCOVERY_HANDOFF events; `.default(null)` (not just `.nullable()`) so a
   * row read from a database that hasn't had migration 0032 applied yet (the key missing
   * entirely, not present-and-null) degrades gracefully rather than crashing every event read —
   * the same convention `applicationSchema`'s Phase 4C/5A/5B.1/7B columns already use. */
  metadata: discoveryHandoffEventMetadataSchema.nullable().default(null),
  revertedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;
