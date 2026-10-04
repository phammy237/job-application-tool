import {
  achievementKindSchema,
  isoDateSchema,
  projectStatusSchema,
  uuidSchema,
  visibilitySchema,
} from '@career-os/shared';
import { z } from 'zod';

/**
 * Validation for the /my/projects forms. Pure (no I/O) so it can be unit-tested. Every parser
 * takes a FormData and returns either parsed data or a single human-readable error; none of them
 * accept a user id — the server actions derive that from the session.
 */

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

function field(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === 'string' ? v : undefined;
}

/** Optional trimmed text: empty/absent becomes null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : null));

const optUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Enter a valid http(s) URL');

const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isoDateSchema.safeParse(v).success, 'Use a valid date (YYYY-MM-DD)');

const optStatus = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || projectStatusSchema.safeParse(v).success, 'Invalid status')
  .transform((v) => (v === null ? null : projectStatusSchema.parse(v)));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === 'on' || v === 'true');

/** Splits on newlines (and commas when `commas`), trims, drops blanks and case-insensitive dupes. */
export function splitList(raw: string | undefined, commas: boolean): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(commas ? /[\n,]/ : /\n/)) {
    const v = part.trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

function run<S extends z.ZodTypeAny>(schema: S, raw: unknown): ParseResult<z.output<S>> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue?.path.join('.');
  return { ok: false, error: path ? `${path}: ${issue?.message}` : (issue?.message ?? 'Invalid input') };
}

function withDateOrder<T extends { startDate: string | null; endDate: string | null }>(
  r: ParseResult<T>,
): ParseResult<T> {
  if (r.ok && r.data.startDate && r.data.endDate && r.data.endDate < r.data.startDate) {
    return { ok: false, error: 'End date must not be before the start date' };
  }
  return r;
}

const nameSchema = z.string().trim().min(1, 'Name is required').max(200);

export const projectIdSchema = uuidSchema;

export function parseCreateProject(fd: FormData) {
  const schema = z.object({
    name: nameSchema,
    role: optText(200),
    summary: optText(4000),
    url: optUrl,
    startDate: optDate,
    endDate: optDate,
    status: optStatus,
  });
  return withDateOrder(
    run(schema, {
      name: field(fd, 'name'),
      role: field(fd, 'role'),
      summary: field(fd, 'summary'),
      url: field(fd, 'url'),
      startDate: field(fd, 'startDate'),
      endDate: field(fd, 'endDate'),
      status: field(fd, 'status'),
    }),
  );
}

export function parseUpdateProject(fd: FormData) {
  const schema = z.object({
    id: uuidSchema,
    name: nameSchema,
    role: optText(200),
    description: optText(8000),
    summary: optText(4000),
    url: optUrl,
    startDate: optDate,
    endDate: optDate,
    status: optStatus,
    collaborators: z
      .string()
      .optional()
      .transform((v) => splitList(v, true))
      .refine((l) => l.length <= 30, 'At most 30 collaborators')
      .refine((l) => l.every((c) => c.length <= 100), 'Each collaborator must be 100 characters or fewer'),
  });
  return withDateOrder(
    run(schema, {
      id: field(fd, 'id'),
      name: field(fd, 'name'),
      role: field(fd, 'role'),
      description: field(fd, 'description'),
      summary: field(fd, 'summary'),
      url: field(fd, 'url'),
      startDate: field(fd, 'startDate'),
      endDate: field(fd, 'endDate'),
      status: field(fd, 'status'),
      collaborators: field(fd, 'collaborators'),
    }),
  );
}

export function parseApproval(fd: FormData) {
  const r = run(
    z.object({
      id: uuidSchema,
      userApproved: checkbox,
      approvedForApplications: checkbox,
    }),
    {
      id: field(fd, 'id'),
      userApproved: field(fd, 'userApproved'),
      approvedForApplications: field(fd, 'approvedForApplications'),
    },
  );
  // Approving for applications is meaningless without the base approval.
  if (r.ok && !r.data.userApproved) r.data.approvedForApplications = false;
  return r;
}

export function parseVisibility(fd: FormData) {
  return run(z.object({ id: uuidSchema, visibility: visibilitySchema }), {
    id: field(fd, 'id'),
    visibility: field(fd, 'visibility'),
  });
}

export function parseTalkingPoints(fd: FormData) {
  return run(
    z.object({
      id: uuidSchema,
      talkingPoints: z
        .string()
        .optional()
        .transform((v) => splitList(v, false))
        .refine((l) => l.length <= 20, 'At most 20 talking points')
        .refine((l) => l.every((p) => p.length <= 500), 'Each talking point must be 500 characters or fewer'),
    }),
    { id: field(fd, 'id'), talkingPoints: field(fd, 'talkingPoints') },
  );
}

export function parseAddSkill(fd: FormData) {
  return run(
    z.object({
      id: uuidSchema,
      skill: z.string().trim().min(1, 'Skill name is required').max(80),
    }),
    { id: field(fd, 'id'), skill: field(fd, 'skill') },
  );
}

export function parseEdgeRemoval(fd: FormData) {
  return run(z.object({ id: uuidSchema, edgeId: uuidSchema }), {
    id: field(fd, 'id'),
    edgeId: field(fd, 'edgeId'),
  });
}

export function parseAddAchievement(fd: FormData) {
  return run(
    z.object({
      id: uuidSchema,
      title: z.string().trim().min(1, 'Title is required').max(300),
      description: optText(4000),
      kind: achievementKindSchema,
      occurredOn: optDate,
      metricText: optText(300),
    }),
    {
      id: field(fd, 'id'),
      title: field(fd, 'title'),
      description: field(fd, 'description'),
      kind: field(fd, 'kind') || 'ACHIEVEMENT',
      occurredOn: field(fd, 'occurredOn'),
      metricText: field(fd, 'metricText'),
    },
  );
}

export function parseIdPair(fd: FormData, key: string) {
  return run(z.object({ id: uuidSchema, other: uuidSchema }), {
    id: field(fd, 'id'),
    other: field(fd, key),
  });
}

export function parseAddEvidence(fd: FormData) {
  const r = run(
    z.object({
      id: uuidSchema,
      title: z.string().trim().min(1, 'Title is required').max(300),
      excerpt: optText(2000),
      sourceUrl: optUrl,
      occurredOn: optDate,
    }),
    {
      id: field(fd, 'id'),
      title: field(fd, 'title'),
      excerpt: field(fd, 'excerpt'),
      sourceUrl: field(fd, 'sourceUrl'),
      occurredOn: field(fd, 'occurredOn'),
    },
  );
  if (r.ok && !r.data.excerpt && !r.data.sourceUrl) {
    return { ok: false, error: 'Add a note or a link so the evidence says something' } as const;
  }
  return r;
}

export function parseIdOnly(fd: FormData) {
  return run(z.object({ id: uuidSchema }), { id: field(fd, 'id') });
}

export const STATUS_FILTERS = ['IDEA', 'ACTIVE', 'COMPLETED', 'ARCHIVED'] as const;
