-- Migration 0048 — pending résumé tailoring drafts (D9 Phase B): standard 4-policy RLS and
-- cross-user isolation on the new table, plus the application_id uniqueness guarantee the
-- orchestrator's "skip if one already exists" behavior depends on. See
-- supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000034', 'resume-draft-user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000035', 'resume-draft-user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000034","role":"authenticated"}';

insert into pgtap_log(line) select lives_ok(
  $$insert into public.applications (id, user_id, company, title)
    values ('d0000000-0000-4000-8000-000000000034', 'a0000000-0000-4000-8000-000000000034',
      'Acme', 'Backend Engineer')$$,
  'user A can create their own application'
);

-- ============================================================================================
-- 1. authenticated can insert/select their own pending draft.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$insert into public.pending_resume_tailoring_drafts (id, user_id, application_id, proposal)
    values ('e0000000-0000-4000-8000-000000000034', 'a0000000-0000-4000-8000-000000000034',
      'd0000000-0000-4000-8000-000000000034', '{"baseResumeVersionId":"f0000000-0000-4000-8000-000000000034"}'::jsonb)$$,
  'authenticated can insert their own pending résumé tailoring draft'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.pending_resume_tailoring_drafts
    where id = 'e0000000-0000-4000-8000-000000000034'),
  1,
  'the draft is visible to its own owner'
);

-- ============================================================================================
-- 2. unique(application_id) — a second draft for the same application is rejected.
-- ============================================================================================
insert into pgtap_log(line) select throws_ok(
  $$insert into public.pending_resume_tailoring_drafts (user_id, application_id, proposal)
    values ('a0000000-0000-4000-8000-000000000034', 'd0000000-0000-4000-8000-000000000034', '{}'::jsonb)$$,
  '23505',
  null,
  'a second draft for the same application_id is rejected (unique constraint)'
);

-- ============================================================================================
-- 3. Cross-user isolation: user B cannot see, update, or delete user A's draft.
-- ============================================================================================
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000035","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.pending_resume_tailoring_drafts
    where id = 'e0000000-0000-4000-8000-000000000034'),
  0,
  'user B cannot see user A''s draft'
);

insert into pgtap_log(line) select lives_ok(
  $$delete from public.pending_resume_tailoring_drafts
    where id = 'e0000000-0000-4000-8000-000000000034'$$,
  'user B''s delete statement against user A''s draft does not error (RLS just matches zero rows)'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000034","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.pending_resume_tailoring_drafts
    where id = 'e0000000-0000-4000-8000-000000000034'),
  1,
  'user A''s draft survived user B''s no-op delete attempt'
);

-- ============================================================================================
-- 4. authenticated can delete their own draft (the "dismiss"/post-save-cleanup path).
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$delete from public.pending_resume_tailoring_drafts
    where id = 'e0000000-0000-4000-8000-000000000034'$$,
  'authenticated can delete their own draft'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.pending_resume_tailoring_drafts
    where id = 'e0000000-0000-4000-8000-000000000034'),
  0,
  'the draft is actually gone after deletion'
);

reset role;

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
