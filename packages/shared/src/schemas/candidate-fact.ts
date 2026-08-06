import { z } from 'zod';
import {
  approvalFieldsSchema,
  isoDateTimeSchema,
  tagsSchema,
  uuidSchema,
} from './common';

/**
 * Matches docs/DATA_MODEL.md `candidate_facts.category`.
 */
export const candidateFactCategorySchema = z.enum([
  'EDUCATION',
  'EXPERIENCE',
  'LEADERSHIP',
  'RESEARCH',
  'PROJECT',
  'SKILL',
  'LANGUAGE',
  'CERTIFICATION',
  'AWARD',
  'WORK_AUTHORIZATION',
  'LOCATION_PREFERENCE',
  'RELOCATION_PREFERENCE',
  'LINK',
  'CONTACT',
]);
export type CandidateFactCategory = z.infer<typeof candidateFactCategorySchema>;

/**
 * The atomic, provenance-tracked fact ledger. Mirrors the fields required by the product
 * spec verbatim: id, userId, category, title, normalizedValue, sourceText, sourceResumeId,
 * userApproved, approvedForApplications, visibleOnPublicProfile, tags, createdAt, updatedAt.
 */
export const candidateFactSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    category: candidateFactCategorySchema,
    title: z.string().min(1),
    normalizedValue: z.string().min(1),
    sourceText: z.string().nullable(),
    sourceResumeId: uuidSchema.nullable(),
    tags: tagsSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .merge(approvalFieldsSchema);
export type CandidateFact = z.infer<typeof candidateFactSchema>;

/** Shape accepted when creating a fact — server derives id/userId/timestamps. */
export const candidateFactInputSchema = candidateFactSchema
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .partial({ tags: true, sourceText: true, sourceResumeId: true });
export type CandidateFactInput = z.infer<typeof candidateFactInputSchema>;

/** Shape accepted when a user edits/approves a fact from /profile. */
export const candidateFactUpdateSchema = candidateFactInputSchema.partial();
export type CandidateFactUpdate = z.infer<typeof candidateFactUpdateSchema>;
