import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const requirementCategorySchema = z.enum([
  'SKILL',
  'EXPERIENCE',
  'EDUCATION',
  'CERTIFICATION',
  'WORK_AUTHORIZATION',
  'LOCATION',
  'LANGUAGE',
  'OTHER',
]);
export type RequirementCategory = z.infer<typeof requirementCategorySchema>;

export const requiredOrPreferredSchema = z.enum(['REQUIRED', 'PREFERRED']);
export type RequiredOrPreferred = z.infer<typeof requiredOrPreferredSchema>;

export const requirementRelationshipSchema = z.enum(['DIRECT', 'EQUIVALENT', 'INFERRED', 'MISSING']);
export type RequirementRelationship = z.infer<typeof requirementRelationshipSchema>;

/**
 * The five heterogeneous tables an approved fact can live in (packages/database's
 * listOwnApprovedFactsForGeneration). A bare fact id is never treated as globally unique on its
 * own — (sourceTable, factId) is always the real compound key, here and in migration 0010's
 * _approved_fact_versions helper.
 */
export const factSourceTableSchema = z.enum([
  'candidate_facts',
  'experiences',
  'education',
  'projects',
  'skills',
]);
export type FactSourceTable = z.infer<typeof factSourceTableSchema>;

/**
 * Server-derived provenance attached to a matched fact after the model's response is validated —
 * never produced by the model itself (docs/IMPLEMENTATION_PLAN.md's round-4 addendum §4/§7).
 * factUpdatedAt is the fact's `updated_at` at the moment of generation, reused (not reinvented) as
 * the version signal for read-time edit detection, since every fact-source table already
 * maintains it via the existing set_updated_at trigger.
 */
export const matchedFactProvenanceSchema = z.object({
  factId: uuidSchema,
  sourceTable: factSourceTableSchema,
  factUpdatedAt: isoDateTimeSchema,
});
export type MatchedFactProvenance = z.infer<typeof matchedFactProvenanceSchema>;

/**
 * The four read-path states a matched fact can resolve to right now, distinct from each other —
 * never collapsed into a single valid/invalid boolean (round-4 addendum §4).
 */
export const evidenceFactValiditySchema = z.enum([
  'valid',
  'changed_since_analysis',
  'unapproved',
  'deleted',
]);
export type EvidenceFactValidity = z.infer<typeof evidenceFactValiditySchema>;

export const enrichedMatchedFactSchema = matchedFactProvenanceSchema.extend({
  validity: evidenceFactValiditySchema,
});
export type EnrichedMatchedFact = z.infer<typeof enrichedMatchedFactSchema>;

/** The persisted `requirement_evidence_mappings` row — matchedFacts here is the raw, immutable
 * provenance captured at generation time (not live-resolved; see requirementEvidenceMappingWithValidity
 * for the read-enriched shape the API actually returns). */
export const requirementEvidenceMappingSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  runId: uuidSchema,
  requirementText: z.string().min(1).max(500),
  requirementCategory: requirementCategorySchema.nullable(),
  requiredOrPreferred: requiredOrPreferredSchema,
  relationship: requirementRelationshipSchema,
  matchedFacts: z.array(matchedFactProvenanceSchema),
  explanation: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
  requiresUserConfirmation: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type RequirementEvidenceMapping = z.infer<typeof requirementEvidenceMappingSchema>;

/** What GET /api/job-snapshots/:id/requirements actually returns — matchedFacts re-resolved
 * against live fact data at read time (round-4 addendum §4). */
export const requirementEvidenceMappingWithValiditySchema = requirementEvidenceMappingSchema
  .omit({ matchedFacts: true })
  .extend({ matchedFacts: z.array(enrichedMatchedFactSchema) });
export type RequirementEvidenceMappingWithValidity = z.infer<
  typeof requirementEvidenceMappingWithValiditySchema
>;

/**
 * The model's raw-response contract for ONE requirement (docs/AI_GROUNDING.md, extended for
 * Phase 5A) — matchedFactIds is a bare id list; the model is never asked to produce sourceTable/
 * factUpdatedAt provenance, only to cite which offered fact ids it used (round-4 addendum §4/§7).
 * The MISSING/INFERRED invariants are re-checked here (Zod refinement) as well as by migration
 * 0010's CHECK constraints — belt-and-suspenders, not a replacement for the DB-level guarantee.
 */
export const requirementMappingContractSchema = z
  .object({
    requirementText: z.string().min(1).max(500),
    requirementCategory: requirementCategorySchema.nullable(),
    requiredOrPreferred: requiredOrPreferredSchema,
    relationship: requirementRelationshipSchema,
    matchedFactIds: z.array(uuidSchema),
    explanation: z.string().min(1).max(400),
    confidence: z.number().min(0).max(1),
    requiresUserConfirmation: z.boolean(),
  })
  .refine(
    (mapping) =>
      mapping.relationship === 'MISSING'
        ? mapping.matchedFactIds.length === 0
        : mapping.matchedFactIds.length >= 1,
    { message: 'MISSING requires zero matchedFactIds; every other relationship requires at least one' },
  )
  .refine((mapping) => mapping.relationship !== 'INFERRED' || mapping.requiresUserConfirmation, {
    message: 'INFERRED relationships must always set requiresUserConfirmation to true',
  });
export type RequirementMappingContract = z.infer<typeof requirementMappingContractSchema>;

/** Max mappings per run (docs/IMPLEMENTATION_PLAN.md round-4 addendum §6) — enforced here, not
 * just by convention, and independently bounded further by the model's own output-token budget. */
export const MAX_REQUIREMENTS_PER_RUN = 60;

export const requirementMappingRunContractSchema = z
  .array(requirementMappingContractSchema)
  .max(MAX_REQUIREMENTS_PER_RUN);
export type RequirementMappingRunContract = z.infer<typeof requirementMappingRunContractSchema>;
