import { z } from 'zod';
import { safeHttpHref } from '../lib/myos/safe-href';
import { isoDateSchema, isoDateTimeSchema, uuidSchema } from './common';

/**
 * myOS evidence-graph schemas. Mirrors supabase/migrations/0060_myos_evidence_graph.sql.
 * See docs/myos/EVIDENCE_MODEL.md.
 */

/** How much the system should trust a statement. AI-derived content is never VERIFIED. */
export const verificationStateSchema = z.enum([
  'VERIFIED',
  'INFERRED',
  'USER_PROVIDED',
  'AI_GENERATED',
]);
export type VerificationState = z.infer<typeof verificationStateSchema>;

/** PRIVATE (default) < CAREER_OS_ONLY < PUBLIC. Only PUBLIC may ever leave Career OS. */
export const visibilitySchema = z.enum(['PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC']);
export type Visibility = z.infer<typeof visibilitySchema>;

export const confidenceSchema = z.number().min(0).max(1);

/** A well-formed http(s) URL. `z.string().url()` alone also accepts javascript:/data: schemes. */
export const httpUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => safeHttpHref(value) !== null, { message: 'Must be an http(s) URL' });

/**
 * Read-side tolerance: a stored non-http(s) URL (written before validation existed) is exposed
 * as null instead of making the whole row unparseable.
 */
const storedUrlSchema = z
  .string()
  .nullable()
  .transform((value) => safeHttpHref(value));

// --------------------------------------------------------------------------------------------
// Nodes & edges
// --------------------------------------------------------------------------------------------

export const nodeTypeSchema = z.enum([
  'PROJECT',
  'EXPERIENCE',
  'EDUCATION',
  'SKILL',
  'ACHIEVEMENT',
  'STORY',
  'EVIDENCE',
]);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const edgeRelationSchema = z.enum([
  'DEMONSTRATES',
  'USES',
  'BELONGS_TO',
  'SUPPORTS',
  'REPRESENTS',
  'REFERENCES',
]);
export type EdgeRelation = z.infer<typeof edgeRelationSchema>;

export const myosEdgeSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  fromType: nodeTypeSchema,
  fromId: uuidSchema,
  toType: nodeTypeSchema,
  toId: uuidSchema,
  relation: edgeRelationSchema,
  verificationState: verificationStateSchema,
  confidence: confidenceSchema.nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type MyosEdge = z.infer<typeof myosEdgeSchema>;

export const myosEdgeInputSchema = myosEdgeSchema
  .omit({ id: true, userId: true, createdAt: true })
  .partial({ confidence: true, note: true })
  .transform((v) => ({ ...v, confidence: v.confidence ?? null, note: v.note ?? null }));
export type MyosEdgeInput = z.input<typeof myosEdgeInputSchema>;

// --------------------------------------------------------------------------------------------
// Evidence
// --------------------------------------------------------------------------------------------

export const evidenceSourceTypeSchema = z.enum([
  'GITHUB_REPO',
  'GITHUB_README',
  'GITHUB_PR',
  'GITHUB_COMMIT',
  'RESUME',
  'USER_NOTE',
  'LINK',
  'DOCUMENT',
  'AWARD',
  'OTHER',
]);
export type EvidenceSourceType = z.infer<typeof evidenceSourceTypeSchema>;

export const myosEvidenceSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  sourceType: evidenceSourceTypeSchema,
  sourceRef: z.string().nullable(),
  sourceUrl: storedUrlSchema,
  title: z.string().min(1),
  excerpt: z.string().max(2000).nullable(),
  occurredAt: isoDateTimeSchema.nullable(),
  confidence: confidenceSchema.nullable(),
  verificationState: verificationStateSchema,
  visibility: visibilitySchema,
  metadata: z.record(z.unknown()),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MyosEvidence = z.infer<typeof myosEvidenceSchema>;

export const myosEvidenceInputSchema = z.object({
  sourceType: evidenceSourceTypeSchema,
  sourceRef: z.string().min(1).nullish(),
  sourceUrl: httpUrlSchema.nullish(),
  title: z.string().trim().min(1).max(300),
  excerpt: z.string().max(2000).nullish(),
  occurredAt: isoDateTimeSchema.nullish(),
  confidence: confidenceSchema.nullish(),
  verificationState: verificationStateSchema,
  visibility: visibilitySchema.default('PRIVATE'),
  metadata: z.record(z.unknown()).default({}),
});
export type MyosEvidenceInput = z.input<typeof myosEvidenceInputSchema>;

// --------------------------------------------------------------------------------------------
// Achievements
// --------------------------------------------------------------------------------------------

export const achievementKindSchema = z.enum([
  'ACHIEVEMENT',
  'AWARD',
  'METRIC',
  'LAUNCH',
  'LEADERSHIP',
  'MILESTONE',
]);
export type AchievementKind = z.infer<typeof achievementKindSchema>;

export const myosAchievementSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  kind: achievementKindSchema,
  occurredOn: isoDateSchema.nullable(),
  metricText: z.string().nullable(),
  projectId: uuidSchema.nullable(),
  experienceId: uuidSchema.nullable(),
  verificationState: verificationStateSchema,
  userApproved: z.boolean(),
  visibility: visibilitySchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MyosAchievement = z.infer<typeof myosAchievementSchema>;

export const myosAchievementInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).nullish(),
  kind: achievementKindSchema.default('ACHIEVEMENT'),
  occurredOn: isoDateSchema.nullish(),
  metricText: z.string().trim().max(300).nullish(),
  projectId: uuidSchema.nullish(),
  experienceId: uuidSchema.nullish(),
  verificationState: verificationStateSchema.default('USER_PROVIDED'),
  userApproved: z.boolean().default(false),
  visibility: visibilitySchema.default('PRIVATE'),
});
export type MyosAchievementInput = z.input<typeof myosAchievementInputSchema>;

// --------------------------------------------------------------------------------------------
// Stories (STAR)
// --------------------------------------------------------------------------------------------

export const COMPETENCIES = [
  'LEADERSHIP',
  'CONFLICT',
  'AMBIGUITY',
  'FAILURE',
  'TECHNICAL_DECISION_MAKING',
  'USER_RESEARCH',
  'PRIORITIZATION',
  'CROSS_FUNCTIONAL_COLLABORATION',
  'DATA_DRIVEN_DECISIONS',
  'OWNERSHIP',
  'EXECUTION',
] as const;
export const competencySchema = z.enum(COMPETENCIES);
export type Competency = z.infer<typeof competencySchema>;

export const myosStorySchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  title: z.string().min(1),
  situation: z.string().nullable(),
  task: z.string().nullable(),
  action: z.string().nullable(),
  result: z.string().nullable(),
  competencies: z.array(competencySchema),
  themes: z.array(z.string()),
  verificationState: verificationStateSchema,
  userApproved: z.boolean(),
  visibility: visibilitySchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MyosStory = z.infer<typeof myosStorySchema>;

export const myosStoryInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  situation: z.string().max(4000).nullish(),
  task: z.string().max(4000).nullish(),
  action: z.string().max(4000).nullish(),
  result: z.string().max(4000).nullish(),
  competencies: z.array(competencySchema).default([]),
  themes: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  verificationState: verificationStateSchema.default('USER_PROVIDED'),
  userApproved: z.boolean().default(false),
  visibility: visibilitySchema.default('PRIVATE'),
});
export type MyosStoryInput = z.input<typeof myosStoryInputSchema>;

// --------------------------------------------------------------------------------------------
// Project extras (columns added to the existing projects table)
// --------------------------------------------------------------------------------------------

export const projectStatusSchema = z.enum(['IDEA', 'ACTIVE', 'COMPLETED', 'ARCHIVED']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectOriginSchema = z.enum(['MANUAL', 'GITHUB', 'RESUME']);

export const myosProjectDetailSchema = z.object({
  projectId: uuidSchema,
  status: projectStatusSchema.nullable(),
  summary: z.string().nullable(),
  collaborators: z.array(z.string()),
  talkingPoints: z.array(z.string()),
  origin: projectOriginSchema,
  visibility: visibilitySchema,
});
export type MyosProjectDetail = z.infer<typeof myosProjectDetailSchema>;

export const myosProjectDetailUpdateSchema = z
  .object({
    status: projectStatusSchema.nullable(),
    summary: z.string().max(4000).nullable(),
    collaborators: z.array(z.string().trim().min(1).max(100)).max(30),
    talkingPoints: z.array(z.string().trim().min(1).max(500)).max(20),
    visibility: visibilitySchema,
  })
  .partial();
export type MyosProjectDetailUpdate = z.infer<typeof myosProjectDetailUpdateSchema>;

// --------------------------------------------------------------------------------------------
// Candidates (INFERRED suggestions awaiting confirmation)
// --------------------------------------------------------------------------------------------

export const candidateKindSchema = z.enum([
  'SKILL',
  'TALKING_POINT',
  'PROJECT_SUMMARY',
  'COMPETENCY',
]);
export type CandidateKind = z.infer<typeof candidateKindSchema>;

export const candidatePayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SKILL'),
    skill: z.string().min(1),
    category: z.string().nullable(),
  }),
  z.object({ kind: z.literal('TALKING_POINT'), text: z.string().min(1) }),
  z.object({ kind: z.literal('PROJECT_SUMMARY'), text: z.string().min(1) }),
  z.object({ kind: z.literal('COMPETENCY'), competency: competencySchema }),
]);
export type CandidatePayload = z.infer<typeof candidatePayloadSchema>;

export const myosCandidateSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  kind: candidateKindSchema,
  projectId: uuidSchema.nullable(),
  payload: candidatePayloadSchema,
  evidenceIds: z.array(uuidSchema),
  rationale: z.string().nullable(),
  dedupeKey: z.string().min(1),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']),
  createdAt: isoDateTimeSchema,
  decidedAt: isoDateTimeSchema.nullable(),
});
export type MyosCandidate = z.infer<typeof myosCandidateSchema>;

export const myosCandidateInputSchema = z.object({
  projectId: uuidSchema.nullable(),
  payload: candidatePayloadSchema,
  evidenceIds: z.array(uuidSchema).default([]),
  rationale: z.string().max(1000).nullish(),
  dedupeKey: z.string().min(1).max(300),
});
export type MyosCandidateInput = z.input<typeof myosCandidateInputSchema>;

// --------------------------------------------------------------------------------------------
// GitHub
// --------------------------------------------------------------------------------------------

export const githubConnectionSchema = z.object({
  userId: uuidSchema,
  githubLogin: z.string().min(1),
  githubUserId: z.number().int().nullable(),
  hasToken: z.boolean(),
  status: z.enum(['CONNECTED', 'ERROR', 'REVOKED']),
  lastError: z.string().nullable(),
  lastSyncedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GithubConnection = z.infer<typeof githubConnectionSchema>;

/** GitHub usernames: 1–39 chars, alphanumeric or single hyphens, no leading/trailing hyphen. */
export const githubLoginSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
    'Invalid GitHub username',
  );

export const githubConnectRequestSchema = z.object({
  login: githubLoginSchema,
  /** Optional fine-grained PAT; omitted ⇒ public repositories only. */
  token: z.string().trim().min(20).max(255).optional(),
});
export type GithubConnectRequest = z.infer<typeof githubConnectRequestSchema>;

export const githubRepositorySchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  githubRepoId: z.number().int(),
  fullName: z.string().min(1),
  description: z.string().nullable(),
  htmlUrl: httpUrlSchema,
  isPrivate: z.boolean(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  defaultBranch: z.string().nullable(),
  primaryLanguage: z.string().nullable(),
  languages: z.record(z.number()),
  topics: z.array(z.string()),
  stars: z.number().int(),
  repoCreatedAt: isoDateTimeSchema.nullable(),
  pushedAt: isoDateTimeSchema.nullable(),
  readmeExcerpt: z.string().nullable(),
  readmeSha: z.string().nullable(),
  contributors: z.array(z.object({ login: z.string(), contributions: z.number().int() })),
  prCount: z.number().int(),
  commitCount: z.number().int(),
  etag: z.string().nullable(),
  selected: z.boolean(),
  projectId: uuidSchema.nullable(),
  syncStatus: z.enum(['PENDING', 'SYNCED', 'ERROR']),
  syncError: z.string().nullable(),
  lastSyncedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GithubRepository = z.infer<typeof githubRepositorySchema>;

/** Normalized repo snapshot produced by the ingestion client (not yet persisted). */
export const githubRepoSnapshotSchema = githubRepositorySchema.pick({
  githubRepoId: true,
  fullName: true,
  description: true,
  htmlUrl: true,
  isPrivate: true,
  isFork: true,
  isArchived: true,
  defaultBranch: true,
  primaryLanguage: true,
  languages: true,
  topics: true,
  stars: true,
  repoCreatedAt: true,
  pushedAt: true,
  readmeExcerpt: true,
  readmeSha: true,
  contributors: true,
  prCount: true,
  commitCount: true,
  etag: true,
});
export type GithubRepoSnapshot = z.infer<typeof githubRepoSnapshotSchema>;

export const githubSyncRunSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  status: z.enum(['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']),
  stats: z.record(z.unknown()),
  error: z.string().nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
});
export type GithubSyncRun = z.infer<typeof githubSyncRunSchema>;

// --------------------------------------------------------------------------------------------
// Portfolio
// --------------------------------------------------------------------------------------------

export const portfolioSettingsSchema = z.object({
  userId: uuidSchema,
  enabled: z.boolean(),
  hasApiKey: z.boolean(),
  displayName: z.string().nullable(),
  headline: z.string().nullable(),
});
export type PortfolioSettings = z.infer<typeof portfolioSettingsSchema>;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/** Strips control characters (incl. NUL/newlines), trims, and maps empty to null. */
const publicTextSchema = (max: number) =>
  z
    .string()
    .nullable()
    .transform((value) => {
      const cleaned = (value ?? '')
        .replace(CONTROL_CHARS_RE, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned === '' ? null : cleaned;
    })
    .refine((value) => value === null || value.length <= max, {
      message: `Must be at most ${max} characters`,
    });

/** Input to upsertOwnPortfolioSettings. These two strings are published on the public API. */
export const portfolioSettingsInputSchema = z.object({
  enabled: z.boolean(),
  displayName: publicTextSchema(80),
  headline: publicTextSchema(160),
});
export type PortfolioSettingsUpdate = z.infer<typeof portfolioSettingsInputSchema>;
