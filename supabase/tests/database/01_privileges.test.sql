-- Privileges + RLS contract (SDD §3, §5). Runs after seed.sql (`supabase test db`).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- the demo guild is found through the demo users; no assertion depends on its names or contents
select set_config('t.dg', (select guild_id::text from members where display_name = 'Demo Captain'), true);
select set_config('t.ncat', (select count(*)::text from categories where guild_id = current_setting('t.dg')::bigint), true);
select set_config('t.nmem', (select count(*)::text from members where guild_id = current_setting('t.dg')::bigint), true);

-- ---------- catalog assertions ----------
select ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
          'RLS is enabled on every public table');

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             cross join unnest(array['anon', 'authenticated']) r
             cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
            where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') and has_table_privilege(r, c.oid, p)),
          0::bigint, 'anon/authenticated hold no write privilege on any public table or view');

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') and has_any_column_privilege('anon', c.oid, 'SELECT')),
          0::bigint, 'anon can read nothing');

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S'
              and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE'))),
          0::bigint, 'clients have no sequence privileges');

select ok(not has_any_column_privilege('authenticated', 'public.member_codes', 'SELECT')
          and not has_any_column_privilege('authenticated', 'public.invites', 'SELECT')
          and not has_any_column_privilege('authenticated', 'public.ai_usage', 'SELECT'),
          'member_codes, invites, ai_usage are not readable by clients');

select ok(not has_column_privilege('authenticated', 'public.members', 'email', 'SELECT')
          and not has_column_privilege('authenticated', 'public.members', 'user_id', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'display_name', 'SELECT'),
          'members.email and members.user_id are not granted');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
          0::bigint, 'anon can execute no public function');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                  aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
          0::bigint, 'PUBLIC can execute no public function');

select ok(not has_function_privilege('authenticated', 'public.award_task(bigint,bigint,int,text,text,bigint,bigint,bigint)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.award_task(bigint,bigint,int,text,text,bigint,bigint,bigint)', 'EXECUTE'),
          'award_task is internal: not executable by anon/authenticated');

select ok(has_function_privilege('authenticated', 'public.submit_task(bigint,text,text,text,bigint[])', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.review_submissions(bigint[],boolean,int,text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.roadmap(bigint)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.leaderboard(bigint)', 'EXECUTE'),
          'slice-1 RPCs are executable by authenticated');

select ok(has_function_privilege('authenticated', 'public.activity(bigint,int)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_role(bigint,text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.activity(bigint,int)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_role(bigint,text)', 'EXECUTE')
          and to_regprocedure('public.set_role(bigint,text,bigint)') is null,
          'v4 signatures: activity and set_role(bigint,text) for authenticated only; the 3-argument set_role is gone');

select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'submissions'
                   and indexdef like '%(member_id, task_id)%'),
          'submissions is indexed by (member_id, task_id)');

-- ---------- fixtures: a second guild, and a member who only exists in a past season ----------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'other.fuksi@demo.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'old.captain@demo.invalid');
with g as (insert into guilds (name, slug) values ('Other Guild', 'other-guild') returning id),
     s as (insert into seasons (guild_id, name, starts_on, ends_on, is_current)
           select id, 'x', '2026-09-01', '2027-05-31', true from g returning guild_id, id)
insert into members (guild_id, season_id, user_id, email, display_name)
select guild_id, id, '00000000-0000-4000-8000-0000000000a1', 'other.fuksi@demo.invalid', 'Other Fuksi' from s;
with s as (insert into seasons (guild_id, name, starts_on, ends_on, is_current)
           select id, 'old', '2025-09-01', '2026-05-31', false from guilds where id = current_setting('t.dg')::bigint returning guild_id, id)
insert into members (guild_id, season_id, user_id, email, display_name, role)
select guild_id, id, '00000000-0000-4000-8000-0000000000a2', 'old.captain@demo.invalid', 'Old Captain', 'captain' from s;


-- ---------- as fuksi 1 ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;

select throws_ok($$insert into public.guilds (name, slug) values ('x', 'x')$$, '42501',
                 'permission denied for table guilds', 'client cannot INSERT');
select throws_ok($$update public.tasks set title = 'x'$$, '42501',
                 'permission denied for table tasks', 'client cannot UPDATE');
select throws_ok($$delete from public.submissions$$, '42501',
                 'permission denied for table submissions', 'client cannot DELETE');
select throws_ok($$select email from public.members$$, '42501',
                 'permission denied for table members', 'members.email is unreadable');
select throws_ok($$select * from public.member_codes$$, '42501',
                 'permission denied for table member_codes', 'member_codes is unreadable');
select throws_ok($$select public.award_task(1, 1, 1, null, 'submission', null, 1, 1)$$, '42501',
                 'permission denied for function award_task', 'client cannot call award_task');
select is((select count(*) from public.guilds), 1::bigint, 'fuksi sees only their own guild');
select is((select count(*) from public.categories), current_setting('t.ncat')::bigint, 'fuksi sees every category of their guild');
select is((select count(*) from public.members), current_setting('t.nmem')::bigint, 'fuksi sees the guild roster (no email)');

-- ---------- as a member of another guild ----------
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select is((select name from public.guilds), 'Other Guild', 'a member of another guild sees only their guild');
select is((select count(*) from public.categories) + (select count(*) from public.tasks)
          + (select count(*) from public.members where guild_id <> (select id from public.guilds)),
          0::bigint, 'other-guild member cannot read DG rows');

-- ---------- as a captain of a PAST season only ----------
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
set local role authenticated;
select is((select count(*) from public.guilds), 0::bigint, 'last season''s captain cannot read the guild');
select is((select count(*) from public.categories) + (select count(*) from public.tasks)
          + (select count(*) from public.submissions) + (select count(*) from public.members),
          0::bigint, 'last season''s captain cannot read current-season rows');
select throws_ok(format('select public.roadmap(%s)', current_setting('t.dg')), '42501',
                 'forbidden', 'last season''s captain cannot call roadmap');

select * from finish();
rollback;
