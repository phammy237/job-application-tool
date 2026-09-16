import { z } from 'zod';

/**
 * D4 V1 role-family taxonomy (docs/JOB_DISCOVERY.md "Role family extraction"). Deliberately
 * small and title-derived only — not a general-purpose job-title ontology. New system-supported
 * families can be added later without redesigning the scoring engine (the registry in
 * `extract-role-family.ts` is the only place new families are wired in); users can never invent
 * their own in V1.
 */
export const roleFamilySchema = z.enum([
  'PRODUCT_MANAGEMENT',
  'TECHNICAL_PROGRAM_MANAGEMENT',
  'PRODUCT_ANALYTICS',
  'DATA_ANALYTICS',
  'DATA_SCIENCE',
  'SOFTWARE_ENGINEERING',
  'BUSINESS_ANALYTICS',
  'STRATEGY_OPERATIONS',
  'CONSULTING',
  'UNKNOWN',
]);
export type RoleFamily = z.infer<typeof roleFamilySchema>;

export const senioritySchema = z.enum([
  'INTERN',
  'NEW_GRAD',
  'ENTRY',
  'MID',
  'SENIOR',
  'STAFF',
  'PRINCIPAL',
  'MANAGER',
  'DIRECTOR_PLUS',
  'UNKNOWN',
]);
export type Seniority = z.infer<typeof senioritySchema>;

export const normalizedEmploymentTypeSchema = z.enum([
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
  'UNKNOWN',
]);
export type NormalizedEmploymentType = z.infer<typeof normalizedEmploymentTypeSchema>;

export const normalizedWorkplaceTypeSchema = z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN']);
export type NormalizedWorkplaceType = z.infer<typeof normalizedWorkplaceTypeSchema>;
