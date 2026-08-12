import {
  applicationSchema,
  autofillSummarySchema,
  unresolvedFieldSummarySchema,
  type Application,
  type ApplicationInput,
  type ApplicationStatus,
  type AutofillSummary,
  type UnresolvedFieldSummary,
} from '@career-os/shared';
import { DatabaseError, assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import { recordApplicationEvent } from './application-events';

type Row = Database['public']['Tables']['applications']['Row'];

/** Both jsonb columns are validated on read, not just trusted — a row written by a future
 * consumer with a slightly different shape fails closed (parse error) rather than silently
 * flowing an unvalidated shape into UI code. */
function parseAutofillSummary(value: unknown): AutofillSummary | null {
  if (value === null || value === undefined) return null;
  return autofillSummarySchema.parse(value);
}

function parseUnresolvedFields(value: unknown): UnresolvedFieldSummary[] | null {
  if (value === null || value === undefined) return null;
  return unresolvedFieldSummarySchema.array().parse(value);
}

/**
 * `applicationSchema`'s Phase 4C fields (`sourceUrl`/`canonicalUrl`/`atsProvider`/`externalId`/
 * `autofillSummary`/`unresolvedFields`/`location`) default to `null` when the *key itself* is
 * missing from a row — not just when it's null — so that reading pre-existing application data
 * in an environment whose database hasn't had migrations 0008/0009 applied yet (e.g. a CI
 * Supabase project, since CI never runs `supabase db push`; see docs/IMPLEMENTATION_PLAN.md
 * Phase 4D) degrades gracefully instead of crashing every application read.
 *
 * This is intentionally narrow — no other field on this schema tolerates a missing key — and it
 * is *not* the thing that would let a missing migration go unnoticed in production: the write
 * path (`upsertApplicationFromExtension`) references these columns directly in raw SQL and
 * fails loudly the moment anyone tries to save an application, which is by far the more likely
 * way a missing migration would actually be discovered. This check exists so the *read* path
 * doesn't stay silent too — it logs once per process (not once per row, to avoid flooding logs
 * in a genuinely broken environment) the first time it notices a row shaped this way, so the gap
 * shows up in server logs even for an install that only ever reads existing applications and
 * never exercises the extension's save flow.
 */
let warnedAboutMissingMigration = false;
function warnIfMigrationColumnsMissing(row: Row): void {
  if (warnedAboutMissingMigration) return;
  if ('source_url' in row) return;
  warnedAboutMissingMigration = true;
  console.warn(
    '[career-os] applications row is missing the migration 0008/0009 columns ' +
      '(source_url and siblings) — the database this environment points at appears to be ' +
      'missing those migrations. Reads will degrade gracefully (nulls), but saving an ' +
      'application from the extension will fail until the migrations are applied.',
  );
}

function rowToApplication(row: Row): Application {
  warnIfMigrationColumnsMissing(row);
  return applicationSchema.parse({
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    resumeId: row.resume_id,
    company: row.company,
    title: row.title,
    status: row.status,
    notes: row.notes,
    appliedAt: row.applied_at,
    location: row.location,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    atsProvider: row.ats_provider,
    externalId: row.external_id,
    autofillSummary: parseAutofillSummary(row.autofill_summary),
    unresolvedFields: parseUnresolvedFields(row.unresolved_fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface ApplicationFilters {
  status?: ApplicationStatus;
  company?: string;
  search?: string;
}

export async function listOwnApplications(
  supabase: CareerOsSupabaseClient,
  userId: string,
  filters: ApplicationFilters = {},
): Promise<Application[]> {
  let query = supabase.from('applications').select('*').eq('user_id', userId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.company) query = query.ilike('company', `%${filters.company}%`);
  if (filters.search) {
    query = query.or(`company.ilike.%${filters.search}%,title.ilike.%${filters.search}%`);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  assertNoError(error, 'listOwnApplications');
  return (data ?? []).map(rowToApplication);
}

export async function getOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Application | null> {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnApplication');
  return data ? rowToApplication(data) : null;
}

/** Creates an application and records the initial SAVED status as a timeline event. */
export async function createOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: ApplicationInput,
): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .insert({
      user_id: userId,
      company: input.company,
      title: input.title,
      status: input.status ?? 'SAVED',
      notes: input.notes ?? null,
      resume_id: input.resumeId ?? null,
      applied_at: input.appliedAt ?? null,
    })
    .select('*')
    .single();
  const application = rowToApplication(unwrapRow(data, error, 'createOwnApplication'));

  await recordApplicationEvent(supabase, userId, {
    applicationId: application.id,
    eventType: 'STATUS_CHANGE',
    fromStatus: null,
    toStatus: application.status,
    source: 'USER',
  });

  return application;
}

/** Updates non-status fields. Use changeOwnApplicationStatus for status transitions. */
export async function updateOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: {
    company?: string;
    title?: string;
    notes?: string | null;
    resumeId?: string | null;
  },
): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .update({
      company: update.company,
      title: update.title,
      notes: update.notes,
      resume_id: update.resumeId,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToApplication(unwrapRow(data, error, 'updateOwnApplication'));
}

/**
 * Manual status change from the dashboard. Always source: 'USER' — this function is not
 * used by the (future) Gmail sync path, which records its own events directly so it can
 * attach an email_signal_id. See docs/DATA_MODEL.md "application_events".
 */
export async function changeOwnApplicationStatus(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  toStatus: ApplicationStatus,
): Promise<Application> {
  const current = await getOwnApplication(supabase, userId, id);
  if (!current) {
    throw new Error('Application not found or not owned by this user.');
  }

  const { data, error } = await supabase
    .from('applications')
    .update({ status: toStatus })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  const application = rowToApplication(
    unwrapRow(data, error, 'changeOwnApplicationStatus'),
  );

  await recordApplicationEvent(supabase, userId, {
    applicationId: id,
    eventType: 'STATUS_CHANGE',
    fromStatus: current.status,
    toStatus,
    source: 'USER',
  });

  return application;
}

export async function deleteOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnApplication');
}

/**
 * "Is this job already tracked?" — the extension's popup calls this right after analysis so it
 * can show "Already tracked (IN_PROGRESS)" before the user does anything (Phase 4C). Matches by
 * job_id only, the cheap/exact case; the full tiered duplicate-matching (requisition id ->
 * canonical url -> company/title) lives in upsertApplicationFromExtension below and is what
 * actually runs at save time, so this check and the save can disagree in principle (e.g. the
 * user re-analyzes a URL that redirected, producing a new jobs row) — that's fine, the save
 * path is the source of truth; this is only a fast, best-effort hint for the UI.
 */
export async function getOwnApplicationByJobId(
  supabase: CareerOsSupabaseClient,
  userId: string,
  jobId: string,
): Promise<Application | null> {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoError(error, 'getOwnApplicationByJobId');
  return data ? rowToApplication(data) : null;
}

export interface UpsertApplicationFromExtensionInput {
  jobId: string;
  company: string;
  title: string;
  location: string | null;
  status: 'SAVED' | 'IN_PROGRESS';
  sourceUrl: string | null;
  canonicalUrl: string | null;
  atsProvider: string | null;
  externalId: string | null;
  autofillSummary: AutofillSummary;
  unresolvedFields: UnresolvedFieldSummary[];
}

export interface UpsertApplicationFromExtensionResult {
  applicationId: string;
  created: boolean;
  status: ApplicationStatus;
  /** Null when a new row was created; otherwise the status the matched row had *before* this
   * call. Lets the caller decide whether a STATUS_CHANGE timeline event is warranted without a
   * second read — a repeat save that doesn't actually change status shouldn't spam the
   * timeline (docs/DATA_MODEL.md "application_events" is meant to reflect real transitions). */
  previousStatus: ApplicationStatus | null;
}

/**
 * Atomic create-or-update via the upsert_application_from_extension Postgres function
 * (supabase/migrations/0008_applications_extension_fields.sql) — see that migration for the
 * full tiered-matching and concurrency design. This wrapper only maps params/results; all the
 * actual dedup/race-safety logic lives in the database function, not here, so two concurrent
 * calls to this function are safe by construction rather than by convention.
 */
export async function upsertApplicationFromExtension(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: UpsertApplicationFromExtensionInput,
): Promise<UpsertApplicationFromExtensionResult> {
  const { data, error } = await supabase
    .rpc('upsert_application_from_extension', {
      p_user_id: userId,
      p_job_id: input.jobId,
      p_company: input.company,
      p_title: input.title,
      p_location: input.location,
      p_status: input.status,
      p_source_url: input.sourceUrl,
      p_canonical_url: input.canonicalUrl,
      p_ats_provider: input.atsProvider,
      p_external_id: input.externalId,
      p_autofill_summary: input.autofillSummary,
      p_unresolved_fields: input.unresolvedFields,
    })
    .single();
  const row = unwrapRow(data, error, 'upsertApplicationFromExtension');
  return {
    applicationId: row.application_id,
    created: row.created,
    status: row.final_status as ApplicationStatus,
    previousStatus: row.previous_status as ApplicationStatus | null,
  };
}

/**
 * The only place applications.status ever becomes APPLIED from the extension — a separate,
 * explicit action (docs/IMPLEMENTATION_PLAN.md Phase 4C: "never infer APPLIED from filling or
 * detecting a submit button"). Sets applied_at alongside status, unlike the generic
 * changeOwnApplicationStatus (which the manual dashboard flow uses and which deliberately
 * doesn't touch applied_at for every status transition) — this one specifically means "the user
 * told us, right now, that they applied."
 */
export async function markOwnApplicationApplied(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Application> {
  const current = await getOwnApplication(supabase, userId, id);
  if (!current) {
    throw new DatabaseError('markOwnApplicationApplied: application not found or not owned by this user.');
  }

  const appliedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('applications')
    .update({ status: 'APPLIED', applied_at: appliedAt })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  const application = rowToApplication(unwrapRow(data, error, 'markOwnApplicationApplied'));

  await recordApplicationEvent(supabase, userId, {
    applicationId: id,
    eventType: 'STATUS_CHANGE',
    fromStatus: current.status,
    toStatus: 'APPLIED',
    source: 'USER',
  });

  return application;
}
