-- RLS isolation + constraint test: email_connections, email_signals
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.email_connections (id, user_id, email_address, encrypted_refresh_token)
values (
  'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'user-a@gmail.com',
  'iv.tag.ciphertext'
);

select is(
  (select count(*)::int from public.email_connections where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own email_connections row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.email_connections where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s email_connections row'
);

update public.email_connections set status = 'ERROR'
  where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.email_connections
    where user_id = 'a0000000-0000-4000-8000-000000000001' and status = 'ERROR'),
  0,
  'user B''s update of user A''s email_connections row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.email_connections where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.email_connections where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s email_connections row affects zero rows'
);

-- unique (user_id, email_address) — reconnecting the same mailbox twice for the same user
-- is rejected rather than creating a duplicate connection.
select throws_ok(
  $$ insert into public.email_connections (user_id, email_address, encrypted_refresh_token)
     values ('a0000000-0000-4000-8000-000000000001', 'user-a@gmail.com', 'iv2.tag2.ciphertext2') $$,
  23505,
  null,
  'unique (user_id, email_address) rejects reconnecting the same mailbox for the same user'
);

insert into public.email_signals (id, user_id, email_connection_id, provider_message_id, sender, sender_domain, subject)
values (
  'd0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'msg-1',
  'careers@acme.com',
  'acme.com',
  'Your application to Acme'
);

select is(
  (select count(*)::int from public.email_signals where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own email_signals row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.email_signals where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s email_signals row'
);

update public.email_signals set confirmation_status = 'DECLINED'
  where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.email_signals
    where user_id = 'a0000000-0000-4000-8000-000000000001' and confirmation_status = 'DECLINED'),
  0,
  'user B''s update of user A''s email_signals row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.email_signals where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.email_signals where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s email_signals row affects zero rows'
);

-- dedup guarantee (docs/EMAIL_INTEGRATION.md §1.9): re-processing the same provider_message_id
-- for the same connection is rejected, not duplicated.
select throws_ok(
  $$ insert into public.email_signals (user_id, email_connection_id, provider_message_id)
     values (
       'a0000000-0000-4000-8000-000000000001',
       'c0000000-0000-4000-8000-000000000001',
       'msg-1'
     ) $$,
  23505,
  null,
  'unique (email_connection_id, provider_message_id) rejects a duplicate dedup key'
);

-- Composite FK: user B inserting a signal that satisfies the insert RLS check (user_id = B, their
-- own auth.uid()) but points email_connection_id at user A's connection must still fail, because
-- no email_connections row exists with (user_id = B, id = A's connection id) — proving the
-- composite (user_id, id) foreign key blocks cross-owner linkage even where a plain id-only FK
-- would have silently allowed it.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ insert into public.email_signals (user_id, email_connection_id, provider_message_id)
     values (
       'a0000000-0000-4000-8000-000000000002',
       'c0000000-0000-4000-8000-000000000001',
       'msg-cross-owner'
     ) $$,
  23503,
  null,
  'composite (user_id, email_connection_id) FK rejects a cross-owner connection reference'
);

-- application_events.email_signal_id FK: deleting the referenced signal sets the column null on
-- any application_events row that pointed at it, rather than failing or leaving a dangling id.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.applications (id, user_id, company, title)
values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer');

insert into public.application_events (user_id, application_id, event_type, from_status, to_status, source, email_signal_id)
values (
  'a0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'STATUS_CHANGE', 'SAVED', 'APPLICATION_RECEIVED', 'GMAIL_SYNC',
  'd0000000-0000-4000-8000-000000000001'
);

delete from public.email_signals where id = 'd0000000-0000-4000-8000-000000000001';

select is(
  (select email_signal_id from public.application_events
    where application_id = 'e0000000-0000-4000-8000-000000000001'),
  null,
  'deleting the referenced email_signals row sets application_events.email_signal_id to null'
);

-- ai_usage_events.task_type accepts the new 'email_classification' value added by this migration.
insert into public.ai_usage_events
  (user_id, generation_run_id, attempt_number, ladder, field_classification, task_type, outcome)
values (
  'a0000000-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333',
  1,
  'deterministic',
  'BASIC_PROFILE',
  'email_classification',
  'accepted'
);

select is(
  (select count(*)::int from public.ai_usage_events
    where user_id = 'a0000000-0000-4000-8000-000000000001' and task_type = 'email_classification'),
  1,
  'ai_usage_events accepts email_classification as a valid task_type'
);

select * from finish();
rollback;
