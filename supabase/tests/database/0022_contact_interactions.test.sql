-- RLS isolation, ownership, and composite-FK/cascade tests for migration 0018
-- (contact_interactions — Phase 6B interaction history). See
-- supabase/tests/database/README.md for how to run this and the general pattern.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

insert into public.contacts (id, user_id, display_name, source)
values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Jane Recruiter', 'MANUAL'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Bob Recruiter', 'MANUAL');

insert into public.applications (id, user_id, company, title, status)
values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer', 'IN_PROGRESS'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Globex', 'Frontend Engineer', 'IN_PROGRESS');

-- Baseline fixture rows: one interaction per user, user A's linked to an application.
insert into public.contact_interactions (id, user_id, contact_id, interaction_type, occurred_at, application_id)
values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'EMAIL', '2026-01-01T00:00:00Z', 'e0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'CALL', '2026-01-02T00:00:00Z', null);

-- ============================================================================================
-- RLS isolation + ownership
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select interaction_type from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000001'),
  'EMAIL',
  'user A can select their own interaction'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000002'),
  0,
  'user A cannot see user B''s interaction'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_interactions (user_id, contact_id, interaction_type, occurred_at)
    values ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'EMAIL', now())$$,
  'new row violates row-level security policy for table "contact_interactions"',
  'user A cannot insert an interaction under user B''s user_id'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_interactions (user_id, contact_id, interaction_type, occurred_at)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'EMAIL', now())$$,
  'insert or update on table "contact_interactions" violates foreign key constraint "contact_interactions_contact_fkey"',
  'user A cannot attach an interaction to user B''s contact — cross-user contact FK is structurally rejected'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_interactions (user_id, contact_id, interaction_type, occurred_at, application_id)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'EMAIL', now(), 'e0000000-0000-4000-8000-000000000002')$$,
  'insert or update on table "contact_interactions" violates foreign key constraint "contact_interactions_application_fkey"',
  'user A cannot attach an interaction to user B''s application — cross-user application FK is structurally rejected'
);

insert into pgtap_log(line) select lives_ok(
  $$insert into public.contact_interactions (id, user_id, contact_id, interaction_type, occurred_at)
    values ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'NOTE', now())$$,
  'a minimal interaction needs only contact_id/interaction_type/occurred_at — no direction/subject/notes/application_id required'
);

set local role postgres;
insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_interactions (user_id, contact_id, interaction_type, occurred_at)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'THANK_YOU', now())$$,
  'new row for relation "contact_interactions" violates check constraint "contact_interactions_interaction_type_check"',
  'an unsupported interaction_type is rejected (e.g. a purpose, not a medium)'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_interactions (user_id, contact_id, interaction_type, occurred_at, direction)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'EMAIL', now(), 'SIDEWAYS')$$,
  'new row for relation "contact_interactions" violates check constraint "contact_interactions_direction_check"',
  'an unsupported direction value is rejected'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_interactions (user_id, contact_id, interaction_type, occurred_at, source)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'EMAIL', now(), 'GMAIL_SIGNAL')$$,
  'new row for relation "contact_interactions" violates check constraint "contact_interactions_source_check"',
  'only MANUAL is a supported source in Phase 6B — no speculative GMAIL_SIGNAL value'
);

-- Verified as user B afterward, not user A: user A's own select of user B's row is already
-- blocked by the select policy regardless of whether the write succeeded, so re-checking as A
-- can't distinguish "write blocked" from "read blocked" (see supabase/tests/database/README.md).
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.contact_interactions set subject = 'hijacked' where id = 'f0000000-0000-4000-8000-000000000002';
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select subject from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000002'),
  null,
  'user A cannot update user B''s interaction — row is unaffected'
);
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

update public.contact_interactions set subject = 'Discussed PM internship' where id = 'f0000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is(
  (select subject from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000001'),
  'Discussed PM internship',
  'user A can update their own interaction'
);

delete from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000002';
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000002'),
  1,
  'user A cannot delete user B''s interaction — it still exists'
);
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

delete from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000001'),
  0,
  'user A can delete their own interaction'
);

set local request.jwt.claims to '{}';
set local role anon;
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_interactions),
  0,
  'anon has no read access to contact_interactions at all'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_interactions (user_id, contact_id, interaction_type, occurred_at)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'EMAIL', now())$$,
  'new row violates row-level security policy for table "contact_interactions"',
  'anon cannot insert into contact_interactions'
);

set local role postgres;

-- ============================================================================================
-- cascade / delete-semantics
-- ============================================================================================

-- Sanity: the remaining fixture interaction (f...003, NOTE, user A, no application) plus a fresh
-- one linked to user A's application, to exercise the application-deletion path independently.
insert into public.contact_interactions (id, user_id, contact_id, interaction_type, occurred_at, application_id)
values ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'COFFEE_CHAT', now(), 'e0000000-0000-4000-8000-000000000001');

insert into pgtap_log(line) select is(
  (select application_id::text from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000004'),
  'e0000000-0000-4000-8000-000000000001',
  'sanity check: the interaction is linked to the application before it is deleted'
);

delete from public.applications where id = 'e0000000-0000-4000-8000-000000000001';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000004'),
  1,
  'deleting the linked application does NOT delete the interaction — it survives'
);

insert into pgtap_log(line) select is(
  (select application_id from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000004'),
  null,
  'deleting the linked application nulls only application_id on the surviving interaction'
);

insert into pgtap_log(line) select is(
  (select user_id::text from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000004'),
  'a0000000-0000-4000-8000-000000000001',
  'user_id on the surviving interaction is untouched by the application deletion'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts where id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'deleting the interaction''s linked application never deletes the contact'
);

-- Deleting a contact cascades to remove its interactions.
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_interactions where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'sanity check: two interactions exist for the contact before it is deleted (f...003 and f...004)'
);

delete from public.contacts where id = 'c0000000-0000-4000-8000-000000000001';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_interactions where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'deleting a contact cascades to remove its contact_interactions'
);

-- Deleting an interaction never deletes the contact or application it referenced.
insert into pgtap_log(line) select lives_ok(
  $$insert into public.contact_interactions (id, user_id, contact_id, interaction_type, occurred_at, application_id)
    values ('f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'MEETING', now(), 'e0000000-0000-4000-8000-000000000002')$$,
  'fixture: a fresh interaction linked to user B''s contact and application'
);

delete from public.contact_interactions where id = 'f0000000-0000-4000-8000-000000000005';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts where id = 'c0000000-0000-4000-8000-000000000002'),
  1,
  'deleting an interaction does not delete the contact it referenced'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where id = 'e0000000-0000-4000-8000-000000000002'),
  1,
  'deleting an interaction does not delete the application it referenced'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
