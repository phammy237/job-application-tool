import {
  applicationSchema,
  autofillSummarySchema,
  computeSubmissionPacketFingerprint,
  unresolvedFieldSummarySchema,
  type Application,
  type ApplicationEventSource,
  type ApplicationInput,
  type ApplicationStatus,
  type AutofillSummary,
  type DiscoveryHandoffEventMetadata,
  type SanitizedJobSnapshotContent,
  type SubmissionPacketAnswer,
  type UnresolvedFieldSummary,
} from '@career-os/shared';
import { DatabaseError, assertNoError, unwrapRow } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import { recordApplicationEvent } from './application-events';
import {
  enforceConsistencyGate,
  evaluateOwnConsistencyFindingsForAnswers,
} from './consistency';
import { listOwnGeneratedAnswersForApplication } from './generated-answers';
import { getCurrentOwnRequirementMappingRun } from './requirement-mapping-runs';
import { markApplicationAppliedAtomic } from './submission-packets';

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
    jobSnapshotId: 'job_snapshot_id' in row ? row.job_snapshot_id : null,
    submissionPacketId: 'submission_packet_id' in row ? row.submission_packet_id : null,
    // Added in migration 0021 (Phase 7B) — same missing-key-on-an-unmigrated-database degrade as
    // jobSnapshotId/submissionPacketId above.
    workingResumeVersionId:
      'working_resume_version_id' in row ? row.working_resume_version_id : null,
    // Added in migration 0032 (D6) — same missing-key-on-an-unmigrated-database degrade.
    jobCatalogId: 'job_catalog_id' in row ? row.job_catalog_id : null,
    // Added in migration 0046 — same missing-key-on-an-unmigrated-database degrade.
    autoTracked: 'auto_tracked' in row ? row.auto_tracked : false,
    // Added in migration 0047 (D9 Phase A) — same missing-key-on-an-unmigrated-database degrade.
    autoQueued: 'auto_queued' in row ? row.auto_queued : false,
    autoQueueStatus: 'auto_queue_status' in row ? row.auto_queue_status : 'NOT_APPLICABLE',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface ApplicationFilters {
  status?: ApplicationStatus;
  company?: string;
  search?: string;
}

/** Candidate applications for the Auto Mode auto-tailoring cron job (D9 Phase B,
 * `runAutoTailorDraftingForUser`) — this user's own auto-queued applications they've explicitly
 * KEPT, that already have a working résumé version attached. Deliberately scoped to the Auto
 * Mode queue only (`auto_queued = true`), never every `SAVED` application a user has — Phase B
 * only drafts for applications the user's own Auto Mode queue produced and they chose to keep,
 * never silently expanding to applications they added manually. Also deliberately does NOT
 * auto-select a working résumé for an application that has none — attaching one is still always
 * the user's own explicit action; this just reads whichever one (if any) they already picked. */
export async function listOwnApplicationsEligibleForAutoTailorDraft(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Application[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .eq('auto_queued', true)
    .eq('auto_queue_status', 'KEPT')
    .not('working_resume_version_id', 'is', null);
  assertNoError(error, 'listOwnApplicationsEligibleForAutoTailorDraft');
  return (data ?? []).map(rowToApplication);
}

/** Which of these `job_catalog_id`s this user already has a tracked application for — a bulk
 * pre-filter the Auto Mode orchestrator (D9 Phase A, `runAutoQueueForUser`) uses to skip calling
 * `startApplicationFromCatalogJob` for a candidate it already knows is tracked, purely as a
 * work/event-noise reduction (that RPC's own Tier-1 idempotency would catch it anyway — this
 * never substitutes for that guarantee). Returns an empty set for an empty input without a
 * network call. */
export async function listOwnTrackedJobCatalogIds(
  supabase: CareerOsSupabaseClient,
  userId: string,
  jobCatalogIds: string[],
): Promise<Set<string>> {
  if (jobCatalogIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('applications')
    .select('job_catalog_id')
    .eq('user_id', userId)
    .in('job_catalog_id', jobCatalogIds);
  assertNoError(error, 'listOwnTrackedJobCatalogIds');
  return new Set((data ?? []).map((row) => row.job_catalog_id).filter((id): id is string => id !== null));
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

/**
 * Creates an application and records its initial status as a timeline event — used by the
 * dashboard's manual "Add application" form. `input.status` is typed as
 * `CreatableApplicationStatus` (docs/IMPLEMENTATION_PLAN.md Phase 5B.0), which structurally
 * excludes `APPLIED` at the type/schema level — but that boundary only protects a caller that
 * goes through `applicationInputSchema.parse(...)` and stays correctly typed afterward. The
 * runtime check below is the actual trust boundary this package's functions are meant to enforce
 * (CLAUDE.md: RLS is the backstop, not the only check — the same posture applies to type safety):
 * a caller that reaches this function with `status: 'APPLIED'` despite the type, e.g. via an
 * unsafe cast or untyped JS, is still rejected here, not silently allowed to create an `APPLIED`
 * row outside `markOwnApplicationApplied`. `applied_at` is otherwise always `null` at creation —
 * there is no valid pairing outside `APPLIED` (docs/DATA_MODEL.md: "`applied_at` ... set only ...
 * alongside `status = 'APPLIED'`"), and no backdate/historical-import input exists in this slice.
 */
export async function createOwnApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: ApplicationInput,
): Promise<Application> {
  if ((input.status as string) === 'APPLIED') {
    throw new DatabaseError(
      'createOwnApplication does not accept APPLIED — use markOwnApplicationApplied, the one ' +
        'canonical operation for that transition (docs/IMPLEMENTATION_PLAN.md Phase 5B.0).',
    );
  }

  const { data, error } = await supabase
    .from('applications')
    .insert({
      user_id: userId,
      company: input.company,
      title: input.title,
      status: input.status ?? 'SAVED',
      notes: input.notes ?? null,
      resume_id: input.resumeId ?? null,
      applied_at: null,
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

/**
 * The one sanctioned exception alongside markOwnApplicationApplied/the historical-revert path
 * (migration 0015's own trigger comment anticipates exactly this case: "mirrors truly legacy
 * pre-Phase-5B.1 data, or test fixture setup") — creates a new application already at
 * status='APPLIED', for the background Gmail cron job (migration 0046) when a confirmation
 * email can't be matched to anything the user already tracks. Service-role only: inserting with
 * `applied_at` set (always non-null here — see below) requires `current_user = service_role`
 * per that trigger, so calling this with an ordinary session-scoped client fails at the database
 * level, not merely by convention.
 *
 * `appliedAt` should be the triggering email's own receivedAt — the closest honest proxy for
 * when the user actually applied, since Career OS has no record of the real event and must
 * never fabricate one. `company`/`title` come from best-effort deterministic parsing of the
 * email (packages/email's extractApplicationIdentity), never invented — `auto_tracked: true` is
 * permanent provenance so the UI can plainly flag this application's data as lower-confidence
 * than one built through Analyze Job / Save Application, instead of presenting it as equivalent.
 */
export async function createAutoTrackedApplicationFromEmail(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: { company: string; title: string; appliedAt: string | null; emailSignalId: string },
): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .insert({
      user_id: userId,
      company: input.company,
      title: input.title,
      status: 'APPLIED',
      applied_at: input.appliedAt,
      auto_tracked: true,
    })
    .select('*')
    .single();
  const application = rowToApplication(
    unwrapRow(data, error, 'createAutoTrackedApplicationFromEmail'),
  );

  await recordApplicationEvent(supabase, userId, {
    applicationId: application.id,
    eventType: 'STATUS_CHANGE',
    fromStatus: null,
    toStatus: 'APPLIED',
    source: 'GMAIL_SYNC',
    emailSignalId: input.emailSignalId,
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
 * Sets (or changes) an application's currently-selected working résumé version
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7B" §12/§17/§35) — a dedicated function, not folded into
 * `updateOwnApplication`, since this is its own explicit action ("Select resume"/"Change"), same
 * posture as `setOwnContactFollowUp`. Cross-user selection is structurally impossible regardless
 * of this function's own `userId` scoping: `applications_working_resume_version_id_fkey`
 * (migration 0021) is a composite `(user_id, working_resume_version_id)` FK against
 * `resume_versions(user_id, id)`, so a `resumeVersionId` belonging to another user simply cannot
 * satisfy it — an attempt surfaces as a Postgres foreign-key-violation error, not a silent
 * cross-user write.
 */
export async function setOwnApplicationWorkingResumeVersion(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  resumeVersionId: string,
): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .update({ working_resume_version_id: resumeVersionId })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) {
    if (error.code === '23503') {
      throw new DatabaseError(
        'setOwnApplicationWorkingResumeVersion: that resume version does not exist or is not ' +
          'owned by this user.',
        error,
      );
    }
    throw new DatabaseError(
      `setOwnApplicationWorkingResumeVersion: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new DatabaseError(
      'setOwnApplicationWorkingResumeVersion: expected a row but got null',
    );
  }
  return rowToApplication(data);
}

/** "Clear working resume" — sets `workingResumeVersionId` back to null. Never touches
 * `submission_packets`; an already-submitted application's frozen `resumeVersionId` is completely
 * unaffected by later clearing or changing the working selection (docs/IMPLEMENTATION_PLAN.md
 * "Phase 7B" §17/§25). */
export async function clearOwnApplicationWorkingResumeVersion(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .update({ working_resume_version_id: null })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToApplication(
    unwrapRow(data, error, 'clearOwnApplicationWorkingResumeVersion'),
  );
}

/**
 * Manual status change from the dashboard. Always source: 'USER' — this function is not
 * used by the (future) Gmail sync path, which records its own events directly so it can
 * attach an email_signal_id. See docs/DATA_MODEL.md "application_events".
 */
/**
 * `source`/`emailSignalId` default to the manual-edit case (`USER`, no signal) — every existing
 * call site keeps its current behavior unchanged. Gmail sync (both the auto-applied path in
 * packages/email's sync.ts and the user-confirmed path in confirmOwnEmailSignal) passes
 * `source: 'GMAIL_SYNC'` and its `emailSignalId` so the resulting application_events row is
 * undoable via the existing revertApplicationEvent/RevertEventButton mechanism with no new code.
 *
 * Never accepts `APPLIED` (docs/IMPLEMENTATION_PLAN.md Phase 5B.0) — that transition has its own
 * semantics (an idempotent `applied_at`, see markOwnApplicationApplied) that this generic
 * function must not duplicate or silently get wrong. `EMAIL_CLASSIFICATION_TO_STATUS` already
 * makes it impossible for the Gmail paths to pass `APPLIED` here at the type level; this guard
 * exists for the one caller that could otherwise: the dashboard's manual status-change control,
 * which must route an `APPLIED` selection through `markOwnApplicationApplied` instead (see
 * apps/web/app/(app)/applications/actions.ts).
 */
export async function changeOwnApplicationStatus(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  toStatus: ApplicationStatus,
  options?: { source?: ApplicationEventSource; emailSignalId?: string | null },
): Promise<Application> {
  if (toStatus === 'APPLIED') {
    throw new DatabaseError(
      'changeOwnApplicationStatus does not handle APPLIED — use markOwnApplicationApplied, the ' +
        'one canonical operation for that transition (docs/IMPLEMENTATION_PLAN.md Phase 5B.0).',
    );
  }

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
    source: options?.source ?? 'USER',
    emailSignalId: options?.emailSignalId ?? null,
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

/** D6's "is this discovery opportunity already tracked?" lookup — used by `/discover/[id]`'s
 * detail page (a single-job read, not the list feed, which instead gets this joined directly into
 * `list_own_discovery_feed` to avoid an N+1 — docs/JOB_DISCOVERY.md "Discovery list
 * integration"). Relies on `applications_user_job_catalog_id_key` (migration 0032) guaranteeing
 * at most one row per (user, job_catalog_id). */
export async function getOwnApplicationByCatalogJobId(
  supabase: CareerOsSupabaseClient,
  userId: string,
  jobCatalogId: string,
): Promise<Application | null> {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .eq('job_catalog_id', jobCatalogId)
    .maybeSingle();
  assertNoError(error, 'getOwnApplicationByCatalogJobId');
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

export interface UpsertApplicationWithSnapshotInput {
  jobId: string;
  status: 'SAVED' | 'IN_PROGRESS';
  snapshot: SanitizedJobSnapshotContent;
  snapshotContentFingerprint: string;
  snapshotContentTruncated: boolean;
  snapshotTruncatedFields: string[];
  location: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  atsProvider: string | null;
  externalId: string | null;
  autofillSummary: AutofillSummary;
  unresolvedFields: UnresolvedFieldSummary[];
}

export interface UpsertApplicationWithSnapshotResult {
  applicationId: string;
  created: boolean;
  status: ApplicationStatus;
  previousStatus: ApplicationStatus | null;
  jobSnapshotId: string | null;
  /** True when the application had already moved past SAVED/IN_PROGRESS (APPLIED or later) —
   * the snapshot was still captured/deduped as usual, but its historical `job_snapshot_id`
   * pointer was deliberately left untouched (docs/IMPLEMENTATION_PLAN.md round-4 addendum §5). */
  snapshotFrozen: boolean;
}

/**
 * Atomic create-or-update-plus-snapshot-capture via the upsert_application_with_snapshot
 * Postgres function (supabase/migrations/0010_job_snapshots_and_requirement_evidence.sql).
 * Deliberately a new, separately-named function rather than an extension of
 * upsertApplicationFromExtension/upsert_application_from_extension — CREATE OR REPLACE FUNCTION
 * cannot change an existing function's argument list without creating an ambiguous PostgREST
 * overload, so that function and its TS wrapper above are left completely untouched. This is now
 * the only call site apps/web/app/api/applications/route.ts uses; upsertApplicationFromExtension
 * remains exported for backward compatibility even though nothing in this repository calls it
 * directly anymore.
 */
export async function upsertApplicationWithSnapshot(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: UpsertApplicationWithSnapshotInput,
): Promise<UpsertApplicationWithSnapshotResult> {
  const { snapshot } = input;
  const { data, error } = await supabase
    .rpc('upsert_application_with_snapshot', {
      p_user_id: userId,
      p_job_id: input.jobId,
      p_status: input.status,
      p_snapshot_company: snapshot.company,
      p_snapshot_title: snapshot.title,
      p_snapshot_location: snapshot.location,
      p_snapshot_employment_type: snapshot.employmentType,
      p_snapshot_source_url: snapshot.sourceUrl,
      p_snapshot_external_id: snapshot.externalId,
      p_snapshot_description: snapshot.description,
      p_snapshot_required_qualifications: snapshot.requiredQualifications,
      p_snapshot_preferred_qualifications: snapshot.preferredQualifications,
      p_snapshot_responsibilities: snapshot.responsibilities,
      p_snapshot_skills: snapshot.skills,
      p_snapshot_salary_min: snapshot.salaryMin,
      p_snapshot_salary_max: snapshot.salaryMax,
      p_snapshot_salary_currency: snapshot.salaryCurrency,
      p_snapshot_locations: snapshot.locations,
      p_snapshot_work_mode: snapshot.workMode,
      p_snapshot_remote_location_restrictions: snapshot.remoteLocationRestrictions,
      p_snapshot_work_authorization_language: snapshot.workAuthorizationLanguage,
      p_snapshot_source_type: snapshot.sourceType,
      p_snapshot_content_fingerprint: input.snapshotContentFingerprint,
      p_snapshot_content_truncated: input.snapshotContentTruncated,
      p_snapshot_truncated_fields: input.snapshotTruncatedFields,
      p_location: input.location,
      p_source_url: input.sourceUrl,
      p_canonical_url: input.canonicalUrl,
      p_ats_provider: input.atsProvider,
      p_external_id: input.externalId,
      p_autofill_summary: input.autofillSummary,
      p_unresolved_fields: input.unresolvedFields,
    })
    .single();
  const row = unwrapRow(data, error, 'upsertApplicationWithSnapshot');
  return {
    applicationId: row.application_id,
    created: row.created,
    status: row.final_status as ApplicationStatus,
    previousStatus: row.previous_status as ApplicationStatus | null,
    jobSnapshotId: row.job_snapshot_id,
    snapshotFrozen: row.snapshot_frozen,
  };
}

export interface StartApplicationFromCatalogJobInput {
  jobCatalogId: string;
  snapshot: SanitizedJobSnapshotContent;
  snapshotContentFingerprint: string;
  snapshotContentTruncated: boolean;
  snapshotTruncatedFields: string[];
  canonicalUrl: string | null;
  eventMetadata: DiscoveryHandoffEventMetadata;
  /** Added in migration 0047 (D9 Phase A) — defaults to `'USER'` server-side (the RPC's own
   * parameter default) when omitted, exactly matching every call site that predates this field.
   * The Auto Mode orchestrator is the one caller that passes `'AUTO_QUEUE'`. */
  eventSource?: ApplicationEventSource;
}

export interface StartApplicationFromCatalogJobResult {
  applicationId: string;
  created: boolean;
  status: ApplicationStatus;
  jobSnapshotId: string | null;
}

/**
 * D6's one canonical handoff operation — wraps `start_application_from_catalog_job` (migration
 * 0032; see that migration's own extensive doc comment for the full idempotency/atomicity/
 * security design). Like `upsertApplicationWithSnapshot`, all the actual dedup/race-safety/
 * APPLIED-exclusion logic lives in the database function, not here; this wrapper only maps
 * params/results. `supabase` MUST be the service-role admin client — `job_snapshots` has no
 * `authenticated` INSERT policy at all, so this call fails under a session-scoped client
 * regardless of caller identity. `userId` must already be verified by the caller (e.g.
 * `requireUser()`) before this is ever invoked — never accepted from request input.
 */
export async function startApplicationFromCatalogJob(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: StartApplicationFromCatalogJobInput,
): Promise<StartApplicationFromCatalogJobResult> {
  const { snapshot } = input;
  const { data, error } = await supabase
    .rpc('start_application_from_catalog_job', {
      p_user_id: userId,
      p_job_catalog_id: input.jobCatalogId,
      p_snapshot_company: snapshot.company,
      p_snapshot_title: snapshot.title,
      p_snapshot_location: snapshot.location,
      p_snapshot_employment_type: snapshot.employmentType,
      p_snapshot_source_url: snapshot.sourceUrl,
      p_snapshot_description: snapshot.description,
      p_snapshot_required_qualifications: snapshot.requiredQualifications,
      p_snapshot_preferred_qualifications: snapshot.preferredQualifications,
      p_snapshot_responsibilities: snapshot.responsibilities,
      p_snapshot_skills: snapshot.skills,
      p_snapshot_salary_min: snapshot.salaryMin,
      p_snapshot_salary_max: snapshot.salaryMax,
      p_snapshot_salary_currency: snapshot.salaryCurrency,
      p_snapshot_locations: snapshot.locations,
      p_snapshot_work_mode: snapshot.workMode,
      p_snapshot_source_type: snapshot.sourceType,
      p_snapshot_content_fingerprint: input.snapshotContentFingerprint,
      p_snapshot_content_truncated: input.snapshotContentTruncated,
      p_snapshot_truncated_fields: input.snapshotTruncatedFields,
      p_canonical_url: input.canonicalUrl,
      p_event_metadata: input.eventMetadata as unknown as Json,
      ...(input.eventSource ? { p_event_source: input.eventSource } : {}),
    })
    .single();
  const row = unwrapRow(data, error, 'startApplicationFromCatalogJob');
  return {
    applicationId: row.application_id,
    created: row.created,
    status: row.application_status as ApplicationStatus,
    jobSnapshotId: row.job_snapshot_id,
  };
}

/**
 * The one place `auto_queued`/`auto_queue_status` ever moves to `true`/`PENDING_REVIEW` (D9 Phase
 * A) — called by `runAutoQueueForUser` immediately after `startApplicationFromCatalogJob` returns
 * `created: true` for a brand-new row. Never called when `created` is `false`: an application the
 * user or extension already has a real relationship with must never be relabeled as "pending your
 * review." Scoped by both `id` and `user_id` even though the caller already knows both from the
 * creation call immediately before this, same explicit-filtering discipline as every other
 * service-role-client write in this codebase (CLAUDE.md: "RLS is the backstop, not the only
 * check" — the admin client this is called through bypasses RLS entirely).
 */
export async function markOwnApplicationAutoQueued(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('applications')
    .update({ auto_queued: true, auto_queue_status: 'PENDING_REVIEW' })
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'markOwnApplicationAutoQueued');
}

/** Every application this user still needs to review from the Auto Mode queue (/dashboard's
 * "Needs your review" section) — mirrors `listOwnEmailSignalsNeedingConfirmation`'s shape. */
export async function listOwnApplicationsPendingAutoQueueReview(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Application[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .eq('auto_queue_status', 'PENDING_REVIEW')
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnApplicationsPendingAutoQueueReview');
  return (data ?? []).map(rowToApplication);
}

/**
 * The user's own Keep/Dismiss decision on one Auto Mode-queued application (D9 Phase A). KEEP
 * only ever flips `auto_queue_status` to `KEPT` — `status` stays `SAVED`, untouched, and no
 * `application_events` row is recorded (not a real status change, same reasoning
 * `updateOwnApplication`'s plain column updates elsewhere in this file never create one). DISMISS
 * routes through the existing `changeOwnApplicationStatus` (source defaults to `'USER'` — a
 * direct result of the human's own click, same as any other manual status change) to set
 * `WITHDRAWN`, then separately marks `auto_queue_status: 'DISMISSED'` — never a delete, the full
 * audit trail (including the original AUTO_QUEUE creation event) survives.
 *
 * Only ever acts on a row still `PENDING_REVIEW` — resolving an already-resolved or never-queued
 * application throws, the same "not found or not owned" message shape `confirmOwnEmailSignal`
 * uses, so a double-submit (e.g. a double-tapped button on a slow phone connection) fails loudly
 * rather than silently re-applying a decision.
 */
export async function resolveOwnAutoQueuedApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  action: 'KEEP' | 'DISMISS',
): Promise<Application> {
  const current = await getOwnApplication(supabase, userId, id);
  if (!current || current.autoQueueStatus !== 'PENDING_REVIEW') {
    throw new DatabaseError('Application not found or not owned by this user.');
  }

  if (action === 'DISMISS') {
    await changeOwnApplicationStatus(supabase, userId, id, 'WITHDRAWN');
  }

  const { data, error } = await supabase
    .from('applications')
    .update({ auto_queue_status: action === 'KEEP' ? 'KEPT' : 'DISMISSED' })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToApplication(unwrapRow(data, error, 'resolveOwnAutoQueuedApplication'));
}

export interface MarkOwnApplicationAppliedOptions {
  /** Finding ids the caller has already shown the user and had them explicitly acknowledge —
   * only ever consulted for WARNING-severity findings; a BLOCKING finding can never be satisfied
   * this way no matter what is passed here (docs/IMPLEMENTATION_PLAN.md Phase 5B.2F). Ignored
   * entirely on the idempotent-already-APPLIED path, since nothing is being (re-)submitted there. */
  acknowledgedFindingIds?: string[];
}

/**
 * The one canonical operation for transitioning an application to APPLIED
 * (docs/IMPLEMENTATION_PLAN.md Phase 5B.0/5B.1/5B.2) — the extension's PATCH /api/applications/:id/
 * mark-applied route and the dashboard's mark-applied action both call this exclusively; neither
 * implements any part of this transition's semantics itself. A separate, explicit action from
 * saving/filling (docs/IMPLEMENTATION_PLAN.md Phase 4C: "never infer APPLIED from filling or
 * detecting a submit button") — this function only ever runs from a real user click, never
 * automatically.
 *
 * As of Phase 5B.1 the actual transition — ownership check, `applied_at` preservation, at-most-
 * once submission-packet creation, status/pointer update, and conditional event recording — is
 * one atomic Postgres transaction (`mark_application_applied`, migration 0013), not a sequence of
 * separate client calls; this function's job is to gather the trusted, already-persisted content
 * that goes *into* a newly-created packet and hand it to that RPC. `applied_at` still represents
 * when the application was *originally* submitted: the RPC sets it only the first time (when
 * still null) and preserves it on every later call.
 *
 * As of Phase 5B.2, every real transition attempt (current status is not already APPLIED) is
 * additionally gated by the deterministic consistency firewall: findings are recomputed here,
 * authoritatively, from scratch — never trusted from an earlier GET /consistency-check or from
 * anything the caller sends — via `enforceConsistencyGate`. A BLOCKING finding always throws
 * `ConsistencyCheckFailedError` before any write is attempted; an unacknowledged WARNING finding
 * does too. Only findings/acknowledgements that survive this gate are ever frozen into a newly-
 * created packet — a reused packet (case 4: transitioning back into APPLIED) is never mutated
 * with a later evaluation's findings, even though the gate still runs to decide whether *this*
 * transition may proceed at all.
 *
 * A legacy application already APPLIED before Phase 5B.1 shipped has no packet and never gets one
 * fabricated from today's data on a repeated call (docs/IMPLEMENTATION_PLAN.md Phase 5B.1G) — the
 * RPC's own already-APPLIED branch is a pure no-op, so this function skips assembling any packet
 * content, and skips the consistency gate entirely, in that case (there is nothing new being
 * submitted to check).
 */
export async function markOwnApplicationApplied(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  options: MarkOwnApplicationAppliedOptions = {},
): Promise<Application> {
  const current = await getOwnApplication(supabase, userId, id);
  if (!current) {
    throw new DatabaseError(
      'markOwnApplicationApplied: application not found or not owned by this user.',
    );
  }

  if (current.status === 'APPLIED') {
    // Idempotent no-op — the RPC returns current state safely without touching anything. See the
    // doc comment above: never assemble or freeze packet content, and never run the consistency
    // gate, for this case — nothing new is being submitted.
    await markApplicationAppliedAtomic(supabase, userId, id, {
      answersSnapshot: [] as unknown as Json,
      autofillSummary: null,
      unresolvedFields: null,
      consistencyFindings: [] as unknown as Json,
      consistencyAcknowledgements: [] as unknown as Json,
      jobSnapshotId: null,
      resumeId: null,
      resumeVersionId: null,
      requirementMappingRunId: null,
      contentFingerprint: 'v1:unused-already-applied',
    });
    return current;
  }

  // A real transition — gather exactly the already-persisted content that will be frozen if this
  // call ends up creating a new packet (it may not: reaching APPLIED again after moving away
  // reuses the existing one — see mark_application_applied's own doc comment).
  const generatedAnswers = await listOwnGeneratedAnswersForApplication(
    supabase,
    userId,
    id,
  );
  const answersSnapshot: SubmissionPacketAnswer[] = generatedAnswers.map((a) => ({
    generatedAnswerId: a.id,
    fieldLabel: a.fieldLabel,
    fieldClassification: a.fieldClassification,
    originalAnswer: a.answer,
    finalText: a.finalText,
    userDecision: a.userDecision,
    sourceFactIds: a.sourceFactIds,
    confidence: a.confidence,
  }));

  // Authoritative gate — recomputed now, from this same already-fetched generatedAnswers list,
  // never trusted from the caller. Throws before any write below is ever attempted.
  const findings = await evaluateOwnConsistencyFindingsForAnswers(
    supabase,
    userId,
    generatedAnswers,
  );
  const consistencyAcknowledgements = enforceConsistencyGate(
    findings,
    options.acknowledgedFindingIds ?? [],
  );

  const requirementMappingRun = current.jobSnapshotId
    ? await getCurrentOwnRequirementMappingRun(supabase, userId, current.jobSnapshotId)
    : null;

  const contentFingerprint = await computeSubmissionPacketFingerprint({
    applicationId: id,
    jobSnapshotId: current.jobSnapshotId,
    resumeId: current.resumeId,
    resumeVersionId: current.workingResumeVersionId,
    requirementMappingRunId: requirementMappingRun?.id ?? null,
    answersSnapshot,
    autofillSummary: current.autofillSummary,
    unresolvedFields: current.unresolvedFields,
    consistencyFindings: findings,
    consistencyAcknowledgements,
  });

  await markApplicationAppliedAtomic(supabase, userId, id, {
    answersSnapshot: answersSnapshot as unknown as Json,
    autofillSummary: current.autofillSummary as unknown as Json | null,
    unresolvedFields: current.unresolvedFields as unknown as Json | null,
    consistencyFindings: findings as unknown as Json,
    consistencyAcknowledgements: consistencyAcknowledgements as unknown as Json,
    jobSnapshotId: current.jobSnapshotId,
    resumeId: current.resumeId,
    // Whatever the application's working résumé version pointed to at this exact instant — see
    // mark_application_applied's own doc comment (migration 0021) for why a repeated call never
    // re-freezes this from a *later* working-version change.
    resumeVersionId: current.workingResumeVersionId,
    requirementMappingRunId: requirementMappingRun?.id ?? null,
    contentFingerprint,
  });

  const application = await getOwnApplication(supabase, userId, id);
  if (!application) {
    throw new DatabaseError(
      'markOwnApplicationApplied: application vanished immediately after being marked applied.',
    );
  }
  return application;
}
