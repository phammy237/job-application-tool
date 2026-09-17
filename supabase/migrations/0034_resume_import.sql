-- Career OS — Resume Import (Phase B of the onboarding-path hardening pass).
--
-- Adds the storage layer for "upload an existing resume so Career OS can extract structured
-- candidate information for review." This migration deliberately does NOT add a second
-- "resume facts" data model — the extracted structured data lives only in the browser (client
-- state) between analysis and the user's explicit confirmation; on confirm, approved items are
-- written through the SAME existing experiences/education/projects/skills/profiles tables and
-- the SAME existing create/upsert functions the manual /profile forms already use.
--
-- IMPORTANT — this builds on EXISTING Phase 7A infrastructure, not a new table. `resume_uploads`
-- (migration 0020) already exists for exactly this purpose — its own doc comment says so
-- verbatim: "an uploaded résumé *file* awaiting a future Claude extraction pipeline... this
-- table has no writer anywhere in this codebase yet; upload UI and extraction still land in a
-- later phase." That later phase is this one. An earlier draft of this migration mistakenly
-- tried to create a brand-new `resume_uploads` table and a mismatched `resume-imports` bucket
-- without first inspecting this existing architecture — caught immediately when `db push`
-- correctly refused ("relation already exists"), reverted before anything but an empty,
-- unreferenced bucket briefly existed (deleted via the Storage API, storage tables refuse a raw
-- SQL delete by design). No data was ever at risk — the existing table had zero rows throughout.
--
-- This migration only: (1) adds the three columns the new upload+dedup path needs, additive and
-- nullable so it degrades safely on any environment mid-migration; (2) adds the private storage
-- bucket the existing `file_path` column was always meant to point into.

alter table public.resume_uploads
  add column if not exists content_hash text,
  add column if not exists content_type text check (content_type is null or content_type in ('application/pdf')),
  add column if not exists file_size_bytes integer check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 5242880));

-- Dedup guarantee: a repeat upload of the identical file (by content, not filename) resolves to
-- the existing row instead of writing a duplicate — the same "v1:" + sha256hex convention
-- job_snapshots.content_fingerprint already established elsewhere in this codebase. Partial
-- (where content_hash is not null) so it never conflicts with a hypothetical pre-existing row
-- that predates this column.
create unique index if not exists resume_uploads_user_content_hash_key
  on public.resume_uploads (user_id, content_hash)
  where content_hash is not null;

-- ============================================================================================
-- Private storage bucket — the existing resume_uploads.file_path column's actual home. Never
-- public; every access goes through a server route that derives user_id from the verified
-- session (never a client-supplied value) and uses the admin client, same posture as every
-- other privileged write path in this codebase. RLS on storage.objects below is the
-- defense-in-depth backstop, not the primary boundary.
-- ============================================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resume-uploads', 'resume-uploads', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Objects are stored at "<user_id>/<content_hash>.pdf" — scoped by the first path segment.
create policy "resume_uploads_bucket_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'resume-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "resume_uploads_bucket_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'resume-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "resume_uploads_bucket_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'resume-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
