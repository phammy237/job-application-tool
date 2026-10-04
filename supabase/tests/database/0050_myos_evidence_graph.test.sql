-- RLS isolation, ownership, edge-integrity and cascade tests for migration 0060 (myOS evidence
-- graph: myos_evidence, myos_achievements, myos_stories, myos_edges, myos_candidates,
-- github_connections, github_credentials, github_repositories, github_sync_runs,
-- portfolio_settings, plus the visibility columns on projects/skills/experiences).
-- See supabase/tests/database/README.md for how to run this and the general pattern.
--
-- NOTE: written without Docker available, so this file has NOT been executed locally. It uses
-- no_plan() (instead of a hard-coded plan(N)) so an arithmetic slip cannot fail the run; run it
-- with `supabase test db` and fix any assertion that genuinely disagrees with the migration.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

-- True when executing the statement (as the CURRENT role) raises any error. Lets forged-write
-- checks stay independent of which layer (BEFORE trigger, RLS, FK) rejects first.
create function pg_temp.raises(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end;
$$;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

-- Fixtures (inserted as the table owner, before impersonation).
insert into public.projects (id, user_id, name) values
  ('d1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A project'), ('d1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'B project');
insert into public.skills (id, user_id, name) values
  ('d2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A skill'), ('d2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'B skill');
insert into public.myos_evidence (id, user_id, source_type, source_ref, title, verification_state) values
  ('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'USER_NOTE', 'note-a', 'A evidence', 'USER_PROVIDED'),
  ('d3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'USER_NOTE', 'note-b', 'B evidence', 'USER_PROVIDED');
insert into public.myos_achievements (id, user_id, title) values
  ('d4000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A ach'), ('d4000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'B ach');
insert into public.myos_stories (id, user_id, title) values
  ('d5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A story'), ('d5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'B story');
insert into public.myos_edges (id, user_id, from_type, from_id, to_type, to_id, relation, verification_state) values
  ('d6000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'EVIDENCE', 'd3000000-0000-4000-8000-000000000001', 'PROJECT', 'd1000000-0000-4000-8000-000000000001', 'SUPPORTS', 'USER_PROVIDED'),
  ('d6000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'EVIDENCE', 'd3000000-0000-4000-8000-000000000002', 'PROJECT', 'd1000000-0000-4000-8000-000000000002', 'SUPPORTS', 'USER_PROVIDED');
insert into public.myos_candidates (id, user_id, kind, project_id, payload, dedupe_key) values
  ('d7000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'SKILL', 'd1000000-0000-4000-8000-000000000001', '{"skill":"A"}', 'a:skill:a'),
  ('d7000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'SKILL', 'd1000000-0000-4000-8000-000000000002', '{"skill":"B"}', 'b:skill:b');
insert into public.github_connections (user_id, github_login) values
  ('a0000000-0000-4000-8000-000000000001', 'alice-gh'), ('a0000000-0000-4000-8000-000000000002', 'bob-gh');
insert into public.github_credentials (user_id, encrypted_access_token) values
  ('a0000000-0000-4000-8000-000000000001', 'enc-a'), ('a0000000-0000-4000-8000-000000000002', 'enc-b');
insert into public.github_repositories (id, user_id, github_repo_id, full_name, html_url) values
  ('d8000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 1001, 'alice/repo', 'https://github.com/alice/repo'),
  ('d8000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 1001, 'bob/repo', 'https://github.com/bob/repo');
insert into public.github_sync_runs (id, user_id) values
  ('d9000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'), ('d9000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');
insert into public.portfolio_settings (user_id, display_name, api_key_hash) values
  ('a0000000-0000-4000-8000-000000000001', 'Alice', 'hash-a'), ('a0000000-0000-4000-8000-000000000002', 'Bob', 'hash-b');

-- ======================================================================================
-- Cross-user isolation as user A
-- ======================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select is((select count(*)::int from public.myos_evidence where id = 'd3000000-0000-4000-8000-000000000001'), 1, 'A can select own myos_evidence row');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_evidence where id = 'd3000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s myos_evidence row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.myos_evidence (user_id, source_type, source_ref, title, verification_state) values (''a0000000-0000-4000-8000-000000000002'',''USER_NOTE'',''forged'',''Forged'',''USER_PROVIDED'')'), 'A cannot insert a myos_evidence row under B''s user_id');
update public.myos_evidence set title = 'hacked' where id = 'd3000000-0000-4000-8000-000000000002';
delete from public.myos_evidence where id = 'd3000000-0000-4000-8000-000000000002';
update public.myos_evidence set title = 'A evidence edited' where id = 'd3000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_evidence where id = 'd3000000-0000-4000-8000-000000000001' and title = 'A evidence edited'), 1, 'A can update own myos_evidence row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000001'), 1, 'A can select own myos_achievements row');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s myos_achievements row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.myos_achievements (user_id, title) values (''a0000000-0000-4000-8000-000000000002'',''Forged'')'), 'A cannot insert a myos_achievements row under B''s user_id');
update public.myos_achievements set title = 'hacked' where id = 'd4000000-0000-4000-8000-000000000002';
delete from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000002';
update public.myos_achievements set title = 'A ach edited' where id = 'd4000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000001' and title = 'A ach edited'), 1, 'A can update own myos_achievements row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000001'), 1, 'A can select own myos_stories row');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s myos_stories row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.myos_stories (user_id, title) values (''a0000000-0000-4000-8000-000000000002'',''Forged'')'), 'A cannot insert a myos_stories row under B''s user_id');
update public.myos_stories set title = 'hacked' where id = 'd5000000-0000-4000-8000-000000000002';
delete from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000002';
update public.myos_stories set title = 'A story edited' where id = 'd5000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000001' and title = 'A story edited'), 1, 'A can update own myos_stories row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000001'), 1, 'A can select own myos_edges row');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s myos_edges row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state) values (''a0000000-0000-4000-8000-000000000002'',''EVIDENCE'',''d3000000-0000-4000-8000-000000000002'',''PROJECT'',''d1000000-0000-4000-8000-000000000002'',''REFERENCES'',''USER_PROVIDED'')'), 'A cannot insert a myos_edges row under B''s user_id');
update public.myos_edges set note = 'hacked' where id = 'd6000000-0000-4000-8000-000000000002';
delete from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000002';
update public.myos_edges set note = 'A edge edited' where id = 'd6000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000001' and note = 'A edge edited'), 1, 'A can update own myos_edges row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_candidates where id = 'd7000000-0000-4000-8000-000000000001'), 1, 'A can select own myos_candidates row');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_candidates where id = 'd7000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s myos_candidates row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.myos_candidates (user_id, kind, payload, dedupe_key) values (''a0000000-0000-4000-8000-000000000002'',''SKILL'',''{"skill":"x"}'',''forged'')'), 'A cannot insert a myos_candidates row under B''s user_id');
update public.myos_candidates set rationale = 'hacked' where id = 'd7000000-0000-4000-8000-000000000002';
delete from public.myos_candidates where id = 'd7000000-0000-4000-8000-000000000002';
update public.myos_candidates set rationale = 'A cand edited' where id = 'd7000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_candidates where id = 'd7000000-0000-4000-8000-000000000001' and rationale = 'A cand edited'), 1, 'A can update own myos_candidates row');

insert into pgtap_log(line) select is((select count(*)::int from public.github_connections where user_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'A can select own github_connections row');
insert into pgtap_log(line) select is((select count(*)::int from public.github_connections where user_id = 'a0000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s github_connections row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.github_connections (user_id, github_login) values (''a0000000-0000-4000-8000-000000000002'',''forged'')'), 'A cannot insert a github_connections row under B''s user_id');
update public.github_connections set github_login = 'hacked' where user_id = 'a0000000-0000-4000-8000-000000000002';
delete from public.github_connections where user_id = 'a0000000-0000-4000-8000-000000000002';
update public.github_connections set github_login = 'alice-edited' where user_id = 'a0000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.github_connections where user_id = 'a0000000-0000-4000-8000-000000000001' and github_login = 'alice-edited'), 1, 'A can update own github_connections row');

insert into pgtap_log(line) select is((select count(*)::int from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000001'), 1, 'A can select own github_repositories row');
insert into pgtap_log(line) select is((select count(*)::int from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s github_repositories row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.github_repositories (user_id, github_repo_id, full_name, html_url) values (''a0000000-0000-4000-8000-000000000002'', 2002, ''f/f'', ''https://github.com/f/f'')'), 'A cannot insert a github_repositories row under B''s user_id');
update public.github_repositories set full_name = 'hacked' where id = 'd8000000-0000-4000-8000-000000000002';
delete from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000002';
update public.github_repositories set full_name = 'alice/edited' where id = 'd8000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000001' and full_name = 'alice/edited'), 1, 'A can update own github_repositories row');

insert into pgtap_log(line) select is((select count(*)::int from public.github_sync_runs where id = 'd9000000-0000-4000-8000-000000000001'), 1, 'A can select own github_sync_runs row');
insert into pgtap_log(line) select is((select count(*)::int from public.github_sync_runs where id = 'd9000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s github_sync_runs row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.github_sync_runs (user_id) values (''a0000000-0000-4000-8000-000000000002'')'), 'A cannot insert a github_sync_runs row under B''s user_id');
update public.github_sync_runs set error = 'hacked' where id = 'd9000000-0000-4000-8000-000000000002';
delete from public.github_sync_runs where id = 'd9000000-0000-4000-8000-000000000002';
update public.github_sync_runs set error = 'A run edited' where id = 'd9000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.github_sync_runs where id = 'd9000000-0000-4000-8000-000000000001' and error = 'A run edited'), 1, 'A can update own github_sync_runs row');

insert into pgtap_log(line) select is((select count(*)::int from public.portfolio_settings where user_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'A can select own portfolio_settings row');
insert into pgtap_log(line) select is((select count(*)::int from public.portfolio_settings where user_id = 'a0000000-0000-4000-8000-000000000002'), 0, 'A cannot see B''s portfolio_settings row');
insert into pgtap_log(line) select ok(pg_temp.raises('insert into public.portfolio_settings (user_id) values (''a0000000-0000-4000-8000-000000000002'')'), 'A cannot insert a portfolio_settings row under B''s user_id');
update public.portfolio_settings set display_name = 'hacked' where user_id = 'a0000000-0000-4000-8000-000000000002';
delete from public.portfolio_settings where user_id = 'a0000000-0000-4000-8000-000000000002';
update public.portfolio_settings set display_name = 'Alice edited' where user_id = 'a0000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.portfolio_settings where user_id = 'a0000000-0000-4000-8000-000000000001' and display_name = 'Alice edited'), 1, 'A can update own portfolio_settings row');

-- Verify A's cross-user writes had no effect, reading as the OWNER (B).
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

insert into pgtap_log(line) select is((select count(*)::int from public.myos_evidence where id = 'd3000000-0000-4000-8000-000000000002' and title = 'B evidence'), 1, 'A''s update/delete of B''s myos_evidence row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_evidence where id = 'd3000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s myos_evidence row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000002' and title = 'B ach'), 1, 'A''s update/delete of B''s myos_achievements row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s myos_achievements row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000002' and title = 'B story'), 1, 'A''s update/delete of B''s myos_stories row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s myos_stories row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000002' and note is null), 1, 'A''s update/delete of B''s myos_edges row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s myos_edges row');

insert into pgtap_log(line) select is((select count(*)::int from public.myos_candidates where id = 'd7000000-0000-4000-8000-000000000002' and rationale is null), 1, 'A''s update/delete of B''s myos_candidates row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_candidates where id = 'd7000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s myos_candidates row');

insert into pgtap_log(line) select is((select count(*)::int from public.github_connections where user_id = 'a0000000-0000-4000-8000-000000000002' and github_login = 'bob-gh'), 1, 'A''s update/delete of B''s github_connections row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.github_connections where user_id = 'a0000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s github_connections row');

insert into pgtap_log(line) select is((select count(*)::int from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000002' and full_name = 'bob/repo'), 1, 'A''s update/delete of B''s github_repositories row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s github_repositories row');

insert into pgtap_log(line) select is((select count(*)::int from public.github_sync_runs where id = 'd9000000-0000-4000-8000-000000000002' and error is null), 1, 'A''s update/delete of B''s github_sync_runs row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.github_sync_runs where id = 'd9000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s github_sync_runs row');

insert into pgtap_log(line) select is((select count(*)::int from public.portfolio_settings where user_id = 'a0000000-0000-4000-8000-000000000002' and display_name = 'Bob'), 1, 'A''s update/delete of B''s portfolio_settings row had no effect');
insert into pgtap_log(line) select is((select count(*)::int from public.portfolio_settings where user_id = 'a0000000-0000-4000-8000-000000000001'), 0, 'B cannot see A''s portfolio_settings row');


-- ======================================================================================
-- github_credentials: service-role only. authenticated can neither read nor write.
-- ======================================================================================

insert into pgtap_log(line) select throws_ok($$select * from public.github_credentials$$, '42501', null, 'authenticated cannot select github_credentials');
insert into pgtap_log(line) select throws_ok($$insert into public.github_credentials (user_id, encrypted_access_token) values ('a0000000-0000-4000-8000-000000000002', 'x')$$, '42501', null, 'authenticated cannot insert github_credentials');
insert into pgtap_log(line) select throws_ok($$update public.github_credentials set encrypted_access_token = 'x'$$, '42501', null, 'authenticated cannot update github_credentials');
insert into pgtap_log(line) select throws_ok($$delete from public.github_credentials$$, '42501', null, 'authenticated cannot delete github_credentials');

-- ======================================================================================
-- Edge endpoint validation (as user B, who owns PB/SB/EB)
-- ======================================================================================

insert into pgtap_log(line) select lives_ok($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000002','SKILL','d2000000-0000-4000-8000-000000000002','DEMONSTRATES','USER_PROVIDED')$$, 'B can link B''s own project to B''s own skill');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000002','SKILL','d2000000-0000-4000-8000-000000000001','USES','USER_PROVIDED')$$, '23503', null, 'edge to a FOREIGN user''s skill is rejected');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000001','SKILL','d2000000-0000-4000-8000-000000000002','USES','USER_PROVIDED')$$, '23503', null, 'edge from a FOREIGN user''s project is rejected');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000002','SKILL','ffffffff-ffff-4fff-8fff-ffffffffffff','USES','USER_PROVIDED')$$, '23503', null, 'edge to a non-existent node is rejected');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000002','SKILL','d2000000-0000-4000-8000-000000000002','DEMONSTRATES','USER_PROVIDED')$$, '23505', null, 'duplicate edge (same endpoints + relation) is rejected');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000002','REFERENCES','USER_PROVIDED')$$, '23514', null, 'self-loop edge is rejected');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','PROJECT','d1000000-0000-4000-8000-000000000002','SKILL','d2000000-0000-4000-8000-000000000002','REFERENCES','MADE_UP')$$, '23514', null, 'invalid verification_state is rejected');
insert into pgtap_log(line) select ok(pg_temp.raises($$insert into public.myos_edges (user_id, from_type, from_id, to_type, to_id, relation, verification_state)
  values ('a0000000-0000-4000-8000-000000000001','PROJECT','d1000000-0000-4000-8000-000000000001','SKILL','d2000000-0000-4000-8000-000000000001','USES','USER_PROVIDED')$$), 'B cannot create an edge owned by A even between A''s own nodes');

-- Retargeting an existing edge to a foreign node is also validated (update trigger).
insert into pgtap_log(line) select throws_ok($$update public.myos_edges set to_id = 'd2000000-0000-4000-8000-000000000001'
  where from_id = 'd1000000-0000-4000-8000-000000000002' and relation = 'DEMONSTRATES'$$, '23503', null, 'updating an edge to point at a FOREIGN node is rejected');

-- ======================================================================================
-- Cascades: deleting a node removes its edges (polymorphic ids have no FK)
-- ======================================================================================

insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where from_id = 'd1000000-0000-4000-8000-000000000002' or to_id = 'd1000000-0000-4000-8000-000000000002'), 2, 'fixture: project PB has two edges (SUPPORTS from evidence + DEMONSTRATES to skill)');
delete from public.skills where id = 'd2000000-0000-4000-8000-000000000002';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where to_id = 'd2000000-0000-4000-8000-000000000002'), 0, 'deleting a skill cascades its edges');
delete from public.myos_evidence where id = 'd3000000-0000-4000-8000-000000000002';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where from_id = 'd3000000-0000-4000-8000-000000000002'), 0, 'deleting evidence cascades its edges');
insert into pgtap_log(line) select is((select count(*)::int from public.projects where id = 'd1000000-0000-4000-8000-000000000002'), 1, 'deleting evidence/skill does not delete the project');


-- ======================================================================================
-- Evidence source idempotency (partial unique index on user_id, source_type, source_ref)
-- ======================================================================================

insert into pgtap_log(line) select lives_ok($$insert into public.myos_evidence (user_id, source_type, source_ref, title, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','GITHUB_REPO','bob/repo','Repo','VERIFIED')$$, 'B can insert evidence with a source_ref');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_evidence (user_id, source_type, source_ref, title, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','GITHUB_REPO','bob/repo','Repo again','VERIFIED')$$, '23505', null, 'same (user, source_type, source_ref) is rejected');
insert into pgtap_log(line) select lives_ok($$insert into public.myos_evidence (user_id, source_type, source_ref, title, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','GITHUB_README','bob/repo','Readme','VERIFIED')$$, 'same source_ref under a different source_type is allowed');
insert into pgtap_log(line) select lives_ok($$insert into public.myos_evidence (user_id, source_type, title, verification_state)
  values ('a0000000-0000-4000-8000-000000000002','USER_NOTE','Note 1','USER_PROVIDED'), ('a0000000-0000-4000-8000-000000000002','USER_NOTE','Note 2','USER_PROVIDED')$$, 'multiple evidence rows with NULL source_ref are allowed');


-- ======================================================================================
-- Defaults, visibility, uniqueness, composite FKs
-- ======================================================================================

insert into public.myos_evidence (id, user_id, source_type, title, verification_state)
  values ('d3000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000002', 'LINK', 'Default visibility', 'USER_PROVIDED');
insert into public.projects (id, user_id, name) values ('d1000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000002', 'Default project');
insert into public.skills (id, user_id, name) values ('d2000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000002', 'Default skill');
insert into pgtap_log(line) select is((select visibility from public.myos_evidence where id = 'd3000000-0000-4000-8000-0000000000aa'), 'PRIVATE', 'evidence visibility defaults to PRIVATE');
insert into pgtap_log(line) select is((select visibility from public.projects where id = 'd1000000-0000-4000-8000-0000000000aa'), 'PRIVATE', 'projects.visibility defaults to PRIVATE');
insert into pgtap_log(line) select is((select visibility from public.skills where id = 'd2000000-0000-4000-8000-0000000000aa'), 'PRIVATE', 'skills.visibility defaults to PRIVATE');
insert into pgtap_log(line) select is((select origin from public.projects where id = 'd1000000-0000-4000-8000-0000000000aa'), 'MANUAL', 'projects.origin defaults to MANUAL');
insert into pgtap_log(line) select is((select verification_state from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000002'), 'USER_PROVIDED', 'achievement verification_state defaults to USER_PROVIDED');
insert into pgtap_log(line) select is((select selected from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000002'), false, 'github_repositories.selected defaults to false');
insert into pgtap_log(line) select is((select enabled from public.portfolio_settings where user_id = 'a0000000-0000-4000-8000-000000000002'), false, 'portfolio_settings.enabled defaults to false');
insert into pgtap_log(line) select throws_ok($$update public.projects set visibility = 'SECRET' where id = 'd1000000-0000-4000-8000-000000000002'$$, '23514', null, 'projects.visibility rejects an unknown value');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_stories (user_id, title, visibility) values ('a0000000-0000-4000-8000-000000000002', 'x', 'WORLD')$$, '23514', null, 'myos_stories.visibility rejects an unknown value');

insert into pgtap_log(line) select throws_ok($$insert into public.myos_candidates (user_id, kind, payload, dedupe_key)
  values ('a0000000-0000-4000-8000-000000000002','SKILL','{"skill":"z"}','b:skill:b')$$, '23505', null, 'duplicate candidate dedupe_key for the same user is rejected');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_candidates (user_id, kind, project_id, payload, dedupe_key)
  values ('a0000000-0000-4000-8000-000000000002','SKILL','d1000000-0000-4000-8000-000000000001','{"skill":"z"}','b:foreign-project')$$, '23503', null, 'candidate pointing at a FOREIGN project is rejected (composite FK)');
insert into pgtap_log(line) select throws_ok($$insert into public.myos_achievements (user_id, title, project_id)
  values ('a0000000-0000-4000-8000-000000000002','x','d1000000-0000-4000-8000-000000000001')$$, '23503', null, 'achievement pointing at a FOREIGN project is rejected (composite FK)');
insert into pgtap_log(line) select throws_ok($$insert into public.github_repositories (user_id, github_repo_id, full_name, html_url)
  values ('a0000000-0000-4000-8000-000000000002', 1001, 'dup/repo', 'https://github.com/dup/repo')$$, '23505', null, 'duplicate (user, github_repo_id) is rejected');
insert into pgtap_log(line) select throws_ok($$update public.github_repositories set project_id = 'd1000000-0000-4000-8000-000000000001' where id = 'd8000000-0000-4000-8000-000000000002'$$, '23503', null, 'repository linked to a FOREIGN project is rejected (composite FK)');
insert into pgtap_log(line) select lives_ok($$update public.github_repositories set project_id = 'd1000000-0000-4000-8000-000000000002', selected = true where id = 'd8000000-0000-4000-8000-000000000002'$$, 'repository can be linked to own project');

-- Deleting a project nulls (not deletes) the repository link, and cascades its candidates.
delete from public.projects where id = 'd1000000-0000-4000-8000-000000000002';
insert into pgtap_log(line) select is((select project_id from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000002'), null, 'deleting a project clears github_repositories.project_id');
insert into pgtap_log(line) select is((select count(*)::int from public.github_repositories where id = 'd8000000-0000-4000-8000-000000000002'), 1, 'deleting a project keeps the repository row');
insert into pgtap_log(line) select is((select count(*)::int from public.myos_candidates where id = 'd7000000-0000-4000-8000-000000000002'), 0, 'deleting a project cascades its candidates');


-- ======================================================================================
-- Own delete + anon access + connection -> credentials cascade
-- ======================================================================================

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
delete from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_achievements where id = 'd4000000-0000-4000-8000-000000000001'), 0, 'A can delete own achievement');
delete from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_stories where id = 'd5000000-0000-4000-8000-000000000001'), 0, 'A can delete own story');
delete from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_edges where id = 'd6000000-0000-4000-8000-000000000001'), 0, 'A can delete own edge');

set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
insert into pgtap_log(line) select is((select count(*)::int from public.myos_evidence), 0, 'anon sees no evidence');
insert into pgtap_log(line) select is((select count(*)::int from public.portfolio_settings), 0, 'anon sees no portfolio_settings (including api_key_hash)');
insert into pgtap_log(line) select throws_ok($$select * from public.github_credentials$$, '42501', null, 'anon cannot select github_credentials');

reset role;
delete from public.github_connections where user_id = 'a0000000-0000-4000-8000-000000000002';
insert into pgtap_log(line) select is((select count(*)::int from public.github_credentials where user_id = 'a0000000-0000-4000-8000-000000000002'), 0, 'deleting a github connection cascades its credentials');
insert into pgtap_log(line) select is((select count(*)::int from public.github_credentials where user_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'the other user''s credentials are untouched');

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
