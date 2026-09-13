-- RLS isolation, ownership, and composite-FK/cascade tests for migration 0017 (contacts,
-- contact_tags, application_contacts — Phase 6A networking foundation). See
-- supabase/tests/database/README.md for how to run this and the general pattern.

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

insert into public.applications (id, user_id, company, title, status)
values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer', 'IN_PROGRESS'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Globex', 'Frontend Engineer', 'IN_PROGRESS');

insert into public.contacts (id, user_id, display_name, source)
values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Jane Recruiter', 'MANUAL'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Bob Recruiter', 'MANUAL');

-- ============================================================================================
-- contacts: RLS isolation + ownership
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select display_name from public.contacts where id = 'c0000000-0000-4000-8000-000000000001'),
  'Jane Recruiter',
  'user A can select their own contact'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts where id = 'c0000000-0000-4000-8000-000000000002'),
  0,
  'user A cannot see user B''s contact'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contacts (user_id, display_name, source)
    values ('a0000000-0000-4000-8000-000000000002', 'Forged', 'MANUAL')$$,
  'new row violates row-level security policy for table "contacts"',
  'user A cannot insert a contact under user B''s user_id'
);

insert into pgtap_log(line) select lives_ok(
  $$insert into public.contacts (id, user_id, display_name, source)
    values ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Minimal Contact', 'MANUAL')$$,
  'a contact needs only display_name and source — no email/title/LinkedIn required'
);

-- Verified as user B afterward, not user A: user A's own select of user B's row is already
-- blocked by the select policy regardless of whether the write succeeded, so re-checking as A
-- can't distinguish "write blocked" from "read blocked" (see supabase/tests/database/README.md).
update public.contacts set display_name = 'Jane R. Recruiter' where id = 'c0000000-0000-4000-8000-000000000002';
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select display_name from public.contacts where id = 'c0000000-0000-4000-8000-000000000002'),
  'Bob Recruiter',
  'user A cannot update user B''s contact — row is unaffected'
);
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

update public.contacts set display_name = 'Jane Updated' where id = 'c0000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is(
  (select display_name from public.contacts where id = 'c0000000-0000-4000-8000-000000000001'),
  'Jane Updated',
  'user A can update their own contact'
);

delete from public.contacts where id = 'c0000000-0000-4000-8000-000000000002';
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts where id = 'c0000000-0000-4000-8000-000000000002'),
  1,
  'user A cannot delete user B''s contact — it still exists'
);
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

set local request.jwt.claims to '{}';
set local role anon;
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts),
  0,
  'anon has no access to contacts at all'
);

set local role postgres;
insert into pgtap_log(line) select throws_ok(
  $$insert into public.contacts (user_id, display_name, source) values ('a0000000-0000-4000-8000-000000000001', '   ', 'MANUAL')$$,
  'new row for relation "contacts" violates check constraint "contacts_display_name_check"',
  'a blank/whitespace-only display_name is rejected'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contacts (user_id, display_name, source) values ('a0000000-0000-4000-8000-000000000001', 'X', 'IMPORT')$$,
  'new row for relation "contacts" violates check constraint "contacts_source_check"',
  'an unsupported source value is rejected'
);

-- ============================================================================================
-- contact_tags: RLS isolation + cross-user contact FK rejection
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select lives_ok(
  $$insert into public.contact_tags (user_id, contact_id, tag)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'RECRUITER')$$,
  'user A can tag their own contact'
);

insert into pgtap_log(line) select lives_ok(
  $$insert into public.contact_tags (user_id, contact_id, tag)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'ALUMNI')$$,
  'multiple tags per contact are supported'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_tags (user_id, contact_id, tag)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'RECRUITER')$$,
  'insert or update on table "contact_tags" violates foreign key constraint "contact_tags_contact_fkey"',
  'user A cannot tag user B''s contact — cross-user contact FK is structurally rejected'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_tags where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s contact tags'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_tags where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'user A sees both of their own contact''s tags'
);

delete from public.contact_tags
  where user_id = 'a0000000-0000-4000-8000-000000000001' and contact_id = 'c0000000-0000-4000-8000-000000000001' and tag = 'ALUMNI';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_tags where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'user A can delete their own contact tag'
);

set local role postgres;
insert into pgtap_log(line) select throws_ok(
  $$insert into public.contact_tags (user_id, contact_id, tag)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'ENEMY')$$,
  'new row for relation "contact_tags" violates check constraint "contact_tags_tag_check"',
  'an unsupported tag value is rejected'
);

-- ============================================================================================
-- application_contacts: composite FK on both sides, PK dedup, cross-user isolation
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select lives_ok(
  $$insert into public.application_contacts (user_id, application_id, contact_id, role)
    values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'REFERRER')$$,
  'user A can link their own contact to their own application'
);

insert into pgtap_log(line) select lives_ok(
  $$insert into public.application_contacts (user_id, application_id, contact_id, role)
    values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'INTERVIEWER')$$,
  'the same contact can hold a second, different role on the same application'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.application_contacts (user_id, application_id, contact_id, role)
    values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'REFERRER')$$,
  'duplicate key value violates unique constraint "application_contacts_pkey"',
  'the exact same (application, contact, role) link cannot be inserted twice'
);

insert into pgtap_log(line) select throws_ok(
  format(
    $$insert into public.application_contacts (user_id, application_id, contact_id, role)
      values ('a0000000-0000-4000-8000-000000000001', %L, 'c0000000-0000-4000-8000-000000000001', 'REFERRER')$$,
    'e0000000-0000-4000-8000-000000000002'
  ),
  'insert or update on table "application_contacts" violates foreign key constraint "application_contacts_application_fkey"',
  'user A contact + user B application is rejected by the composite application FK'
);

insert into pgtap_log(line) select throws_ok(
  format(
    $$insert into public.application_contacts (user_id, application_id, contact_id, role)
      values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', %L, 'REFERRER')$$,
    'c0000000-0000-4000-8000-000000000002'
  ),
  'insert or update on table "application_contacts" violates foreign key constraint "application_contacts_contact_fkey"',
  'user B contact + user A application is rejected by the composite contact FK'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_contacts where application_id = 'e0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s application_contacts links'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
delete from public.application_contacts
  where application_id = 'e0000000-0000-4000-8000-000000000001' and role = 'INTERVIEWER';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_contacts where application_id = 'e0000000-0000-4000-8000-000000000001'),
  1,
  'user A can unlink one of their own application_contacts rows'
);

set local request.jwt.claims to '{}';
set local role anon;
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_contacts),
  0,
  'anon has no access to application_contacts at all'
);

-- ============================================================================================
-- cascade behavior
-- ============================================================================================

set local role postgres;

-- Deleting a contact removes its tags and any application_contacts links, but the application
-- itself must survive untouched.
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_contacts where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'sanity check: the link row exists before the contact is deleted'
);

delete from public.contacts where id = 'c0000000-0000-4000-8000-000000000001';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contact_tags where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'deleting a contact cascades to remove its contact_tags'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_contacts where contact_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'deleting a contact cascades to remove its application_contacts links'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where id = 'e0000000-0000-4000-8000-000000000001'),
  1,
  'deleting a contact does NOT delete the application it was linked to'
);

-- Deleting an application removes application_contacts links, but the contact itself survives.
insert into pgtap_log(line) select lives_ok(
  $$insert into public.application_contacts (user_id, application_id, contact_id, role)
    values ('a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'RECRUITER')$$,
  'fixture: link user B''s contact to user B''s application'
);

delete from public.applications where id = 'e0000000-0000-4000-8000-000000000002';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_contacts where application_id = 'e0000000-0000-4000-8000-000000000002'),
  0,
  'deleting an application cascades to remove its application_contacts links'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts where id = 'c0000000-0000-4000-8000-000000000002'),
  1,
  'deleting an application does NOT delete the contact that was linked to it'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
