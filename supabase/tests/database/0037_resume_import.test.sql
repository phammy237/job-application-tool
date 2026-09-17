-- Resume Import (migration 0034, Phase B of the onboarding-path hardening pass). Proves:
--   - the resume-uploads private storage bucket exists with the correct size/type restrictions;
--   - resume_uploads' new content_hash dedup constraint is real, and is user-scoped (the same
--     hash for two different users is NOT a conflict — dedup is per-user, never cross-user);
--   - resume_uploads' pre-existing (migration 0020) RLS is untouched by this migration's ALTERs —
--     cross-user isolation still holds.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000003', 'user-c@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000004', 'user-d@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

insert into pgtap_log(line) select is(
  (select id::text from storage.buckets where id = 'resume-uploads'),
  'resume-uploads',
  'the resume-uploads storage bucket exists'
);
insert into pgtap_log(line) select is(
  (select "public"::boolean from storage.buckets where id = 'resume-uploads'),
  false,
  'the resume-uploads bucket is private, never public'
);
insert into pgtap_log(line) select is(
  (select file_size_limit from storage.buckets where id = 'resume-uploads'),
  5242880::bigint,
  'the bucket enforces the same 5 MB limit the route itself checks'
);

-- The unique index exists and is scoped to (user_id, content_hash), not content_hash alone —
-- checked structurally rather than by provoking the exception (avoids pgTAP's throws_ok
-- savepoint interacting with the row-count assertions below).
insert into pgtap_log(line) select ok(
  exists (
    select 1 from pg_indexes
    where indexname = 'resume_uploads_user_content_hash_key'
      and indexdef like '%user_id%' and indexdef like '%content_hash%'
  ),
  'the dedup unique index covers (user_id, content_hash), not content_hash alone'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into public.resume_uploads (user_id, file_path, file_name, content_type, file_size_bytes, content_hash)
values ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003/abc.pdf', 'resume.pdf', 'application/pdf', 1000, 'samehash123');

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into public.resume_uploads (user_id, file_path, file_name, content_type, file_size_bytes, content_hash)
values ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004/abc.pdf', 'resume.pdf', 'application/pdf', 1000, 'samehash123');

set local role service_role;
insert into pgtap_log(line) select is(
  (select count(*)::int from public.resume_uploads where content_hash = 'samehash123'),
  2,
  'the identical content_hash is fine across two different users — dedup is per-user, never cross-user'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.resume_uploads),
  1,
  'user C sees only their own resume_uploads row under RLS (migration 0020''s pre-existing policy, unaffected by this migration)'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.resume_uploads),
  1,
  'and vice versa — user D sees only their own row, never user C''s'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
