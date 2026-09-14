-- Career OS — Phase 7C: structured résumé content.
--
-- Widens resume_versions.snapshot_format (migration 0020) to add STRUCTURED_V1 alongside the
-- existing METADATA_ONLY — additive only, exactly as that migration's own comment promised
-- ("a later phase adds real content formats... this union only grows to describe formats that
-- actually exist, never in advance of them"). Every existing METADATA_ONLY row keeps its exact
-- meaning; nothing here reinterprets or backfills a single existing row.
--
-- The canonical content lives in snapshot_payload as a self-describing StructuredResumeV1 JSON
-- object (its own `schemaVersion: 1` field, independent of this column, so a future
-- STRUCTURED_V2 can coexist with old STRUCTURED_V1 rows without either ever being reinterpreted).
-- LaTeX is a deterministic, pure *rendering* of that JSON — never itself the stored source of
-- truth, and never regenerated/stored in the database (packages/shared's
-- renderStructuredResumeToLatex is cheap and pure; there is nothing to cache). The one exception
-- is an explicit user-authored "custom LaTeX override," which — being genuinely unrepresentable
-- as structured data — is stored as an ordinary field *inside* the same JSON payload
-- (`renderOverride`), not a second database column: see packages/shared's resume-content.ts for
-- why that keeps a single immutable JSON blob as the one thing this table snapshots, rather than
-- introducing a second historical-fact column pair.
--
-- No RPC change needed: create_resume_version (migration 0020, Part 4) already accepts
-- p_snapshot_format/p_snapshot_payload as parameters — it has never been hardcoded to
-- METADATA_ONLY, that was simply the only value any caller passed until now.

alter table public.resume_versions drop constraint resume_versions_snapshot_format_check;
alter table public.resume_versions drop constraint resume_versions_metadata_only_has_no_payload;

alter table public.resume_versions
  add constraint resume_versions_snapshot_format_check
  check (snapshot_format in ('METADATA_ONLY', 'STRUCTURED_V1'));

-- Replaces the old one-directional check (METADATA_ONLY implies null payload) with a
-- format-aware, two-directional one: METADATA_ONLY must have a null payload (unchanged), and
-- STRUCTURED_V1 must have a non-null one — a STRUCTURED_V1 row with no actual content would be
-- exactly the kind of fabricated placeholder this schema has avoided since Phase 7A.
alter table public.resume_versions
  add constraint resume_versions_snapshot_payload_matches_format
  check (
    (snapshot_format = 'METADATA_ONLY' and snapshot_payload is null)
    or (snapshot_format = 'STRUCTURED_V1' and snapshot_payload is not null)
  );

-- A shallow structural guard, same spirit as submission_packets' own jsonb_typeof checks — the
-- real shape validation (StructuredResumeV1's Zod schema) happens in application code before
-- this RPC is ever called; this is just the database's own independent backstop against a
-- non-object payload slipping in some other way.
alter table public.resume_versions
  add constraint resume_versions_structured_payload_is_object
  check (snapshot_format <> 'STRUCTURED_V1' or jsonb_typeof(snapshot_payload) = 'object');
