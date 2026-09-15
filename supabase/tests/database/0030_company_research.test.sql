-- RLS + invariant tests: company research (migration 0025, Phase 7G) — snapshots, sources,
-- findings, finding-source citations, and the atomic create_company_research_snapshot RPC.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

insert into public.applications (id, user_id, company, title, status)
values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Engineer', 'IN_PROGRESS');
insert into public.applications (id, user_id, company, title, status)
values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Beta', 'Role', 'IN_PROGRESS');

-- ------------------------------------------------------------------------------------------------
-- Direct authenticated calls to the RPC are rejected — service_role only.
-- ------------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.create_company_research_snapshot(
       'a0000000-0000-4000-8000-000000000001'::uuid, null, 'Acme', 'Engineer', null,
       '[{"id":"e0000000-0000-4000-8000-000000000001","url":"https://acme.com","title":"Acme","sourceType":"OFFICIAL_WEBSITE"}]'::jsonb,
       '[{"id":"f0000000-0000-4000-8000-000000000001","category":"PRODUCT","claim":"x","sourceIds":["e0000000-0000-4000-8000-000000000001"]}]'::jsonb
     ) $$,
  '42501',
  null,
  'an authenticated user cannot call create_company_research_snapshot directly'
);

set local role service_role;

-- ------------------------------------------------------------------------------------------------
-- Cross-user rejection: another user's application.
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_company_research_snapshot(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid,
       'Acme', 'Engineer', null,
       '[{"id":"e0000000-0000-4000-8000-000000000001","url":"https://acme.com","title":"Acme","sourceType":"OFFICIAL_WEBSITE"}]'::jsonb,
       '[{"id":"f0000000-0000-4000-8000-000000000001","category":"PRODUCT","claim":"x","sourceIds":["e0000000-0000-4000-8000-000000000001"]}]'::jsonb
     ) $$,
  'application_not_found',
  'user A cannot attach research to user B''s application'
);

-- A finding citing an unknown source id is rejected.
select throws_ok(
  $$ select public.create_company_research_snapshot(
       'a0000000-0000-4000-8000-000000000001'::uuid, null, 'Acme', 'Engineer', null,
       '[{"id":"e0000000-0000-4000-8000-000000000001","url":"https://acme.com","title":"Acme","sourceType":"OFFICIAL_WEBSITE"}]'::jsonb,
       '[{"id":"f0000000-0000-4000-8000-000000000001","category":"PRODUCT","claim":"x","sourceIds":["99999999-9999-4999-8999-999999999999"]}]'::jsonb
     ) $$,
  'create_company_research_snapshot: finding f0000000-0000-4000-8000-000000000001 cites unknown sourceId "99999999-9999-4999-8999-999999999999"',
  'a finding citing an unknown source id is rejected — no uncited/mis-cited factual findings'
);

-- ------------------------------------------------------------------------------------------------
-- Successful creation (snapshot 1), then a second call (refresh) creates a SECOND immutable
-- snapshot rather than mutating the first (§30).
-- ------------------------------------------------------------------------------------------------

select public.create_company_research_snapshot(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  'Acme', 'Engineer', null,
  '[{"id":"e0000000-0000-4000-8000-000000000001","url":"https://acme.com/news","title":"Acme News","sourceType":"OFFICIAL_NEWSROOM","publishedAt":"2026-09-10T00:00:00Z","evidenceExcerpt":"Acme launched X."}]'::jsonb,
  '[{"id":"f0000000-0000-4000-8000-000000000001","category":"PRODUCT","claim":"Acme launched X.","roleRelevance":"Relevant to this role.","requirementIds":["req-1"],"sourceIds":["e0000000-0000-4000-8000-000000000001"]}]'::jsonb
);

select is(
  (select count(*)::int from public.company_research_snapshots where application_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'the first research call creates exactly one snapshot'
);

select public.create_company_research_snapshot(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  'Acme', 'Engineer', null,
  '[{"id":"e0000000-0000-4000-8000-000000000002","url":"https://acme.com/news2","title":"Acme News 2","sourceType":"OFFICIAL_NEWSROOM"}]'::jsonb,
  '[{"id":"f0000000-0000-4000-8000-000000000002","category":"PRODUCT","claim":"Acme launched Y.","sourceIds":["e0000000-0000-4000-8000-000000000002"]}]'::jsonb
);

select is(
  (select count(*)::int from public.company_research_snapshots where application_id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'refresh creates a SECOND immutable snapshot rather than mutating the first'
);
select is(
  (select count(*)::int from public.company_research_sources where url = 'https://acme.com/news'),
  1,
  'the first snapshot''s own source is untouched by the refresh'
);

-- ------------------------------------------------------------------------------------------------
-- RLS: user A can read their own rows; user B sees none of them.
-- ------------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.company_research_snapshots where application_id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'the owner can select their own company_research_snapshots'
);
select is(
  (select count(*)::int from public.company_research_sources where snapshot_id in (
    select id from public.company_research_snapshots where application_id = 'c0000000-0000-4000-8000-000000000001'
  )),
  2,
  'the owner can select their own company_research_sources'
);
select is(
  (select count(*)::int from public.company_research_findings where snapshot_id in (
    select id from public.company_research_snapshots where application_id = 'c0000000-0000-4000-8000-000000000001'
  )),
  2,
  'the owner can select their own company_research_findings'
);
select is(
  (select count(*)::int from public.company_research_finding_sources where snapshot_id in (
    select id from public.company_research_snapshots where application_id = 'c0000000-0000-4000-8000-000000000001'
  )),
  2,
  'the owner can select their own company_research_finding_sources'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.company_research_snapshots where application_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s company_research_snapshots'
);
select is(
  (select count(*)::int from public.company_research_sources s
     join public.company_research_snapshots sn on sn.id = s.snapshot_id
     where sn.application_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s company_research_sources'
);
select is(
  (select count(*)::int from public.company_research_findings f
     join public.company_research_snapshots sn on sn.id = f.snapshot_id
     where sn.application_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s company_research_findings'
);
select is(
  (select count(*)::int from public.company_research_finding_sources fs
     join public.company_research_snapshots sn on sn.id = fs.snapshot_id
     where sn.application_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s company_research_finding_sources'
);

-- ------------------------------------------------------------------------------------------------
-- Immutability: no role, including one that bypasses RLS, can update a completed row.
-- ------------------------------------------------------------------------------------------------

set local role postgres;
select throws_ok(
  $$ update public.company_research_snapshots set company_name = 'Renamed' where company_name = 'Acme' $$,
  'company_research_snapshots rows are immutable and cannot be updated (id=' || (
    select id::text from public.company_research_snapshots where company_name = 'Acme' limit 1
  ) || ')',
  'a company_research_snapshots row is immutable even for a role that bypasses RLS entirely'
);
select throws_ok(
  $$ update public.company_research_findings set claim = 'Renamed' where claim = 'Acme launched X.' $$,
  'company_research_findings rows are immutable and cannot be updated (id=' || (
    select id::text from public.company_research_findings where claim = 'Acme launched X.' limit 1
  ) || ')',
  'a company_research_findings row is immutable even for a role that bypasses RLS entirely'
);

-- ------------------------------------------------------------------------------------------------
-- Cross-snapshot citation is structurally impossible, even for a role that bypasses RLS: a raw
-- insert linking user A's OWN finding (snapshot 1) to user A's OWN source from a DIFFERENT
-- snapshot (snapshot 2) is rejected by the composite (user_id, source_id, snapshot_id) FK.
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  format(
    $$ insert into public.company_research_finding_sources (user_id, snapshot_id, finding_id, source_id)
       values (
         'a0000000-0000-4000-8000-000000000001',
         %L,
         'f0000000-0000-4000-8000-000000000001',
         'e0000000-0000-4000-8000-000000000002'
       ) $$,
    (select snapshot_id from public.company_research_findings where id = 'f0000000-0000-4000-8000-000000000001')
  ),
  '23503',
  null,
  'a finding cannot cite a source from a different snapshot, even for the same user'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------------------------------------
-- Application-delete semantics: deleting the application nulls the snapshot's application_id
-- (never cascades) — historical research survives with its own frozen company/role text.
-- ------------------------------------------------------------------------------------------------

delete from public.applications where id = 'c0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.company_research_snapshots where company_name = 'Acme'),
  2,
  'deleting the application does not delete its research snapshots'
);
select is(
  (select application_id from public.company_research_snapshots where company_name = 'Acme' limit 1),
  null,
  'deleting the application nulls the snapshot''s application_id rather than cascading'
);
select is(
  (select role_title from public.company_research_snapshots where company_name = 'Acme' limit 1),
  'Engineer',
  'the snapshot keeps its own frozen company/role text after the application is gone'
);

-- ------------------------------------------------------------------------------------------------
-- Delete snapshot cascades its own children (sources/findings/finding_sources) — the owner can
-- delete their own research; nothing is left orphaned.
-- ------------------------------------------------------------------------------------------------

set local role service_role;
create temporary table snap2 as
  select id as snap2_id from public.company_research_snapshots
  where company_name = 'Acme' order by created_at desc limit 1;
grant select on snap2 to authenticated;

set local role authenticated;
delete from public.company_research_snapshots where id = (select snap2_id from snap2);

select is(
  (select count(*)::int from public.company_research_sources where snapshot_id = (select snap2_id from snap2)),
  0,
  'deleting a snapshot cascades to its own sources'
);
select is(
  (select count(*)::int from public.company_research_findings where snapshot_id = (select snap2_id from snap2)),
  0,
  'deleting a snapshot cascades to its own findings'
);
select is(
  (select count(*)::int from public.company_research_finding_sources where snapshot_id = (select snap2_id from snap2)),
  0,
  'deleting a snapshot cascades to its own finding_sources links'
);
select is(
  (select count(*)::int from public.company_research_snapshots where company_name = 'Acme'),
  1,
  'the OTHER snapshot (from the first research call) is completely unaffected'
);

-- User B still cannot delete user A's remaining snapshot (RLS filters it to zero rows affected,
-- not an error).
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.company_research_snapshots where company_name = 'Acme';
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.company_research_snapshots where company_name = 'Acme'),
  1,
  'user B''s delete attempt affects zero of user A''s remaining snapshots'
);

select * from finish();
rollback;
