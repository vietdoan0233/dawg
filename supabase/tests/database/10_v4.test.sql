-- v4 (0008, SDD §11.1): individual leaderboard, activity feed, next_tier, no tutor groups, shared review queue.
-- Generic fixtures: guild V (4 fuksis incl. one unclaimed roster row, 2 tutors, a captain) and guild W (1 fuksi).
-- Nothing depends on the demo data, except the next_tier/member_tier parity check, which walks every seeded fuksi.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- ---------- fixtures (as table owner) ----------
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, 'v4.' || k || '@demo.invalid'
  from unnest(array['d1','d2','d3','d4','d5','d6','d9','e1']) k;

create function pg_temp.as_user(k text) returns text language sql as $$
  select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000' || k, true) $$;
create function pg_temp.id(k text) returns bigint language sql as $$ select current_setting('t.' || k)::bigint $$;
create function pg_temp.task(p_title text) returns bigint language sql as $$
  select id from public.tasks where title = p_title and guild_id = current_setting('t.gv')::bigint $$;
-- the leaderboard as one comparable string: name:total:tier:week:rank:rank_week_ago
create function pg_temp.board() returns text language sql as $$
  select string_agg(display_name || ':' || total || ':' || coalesce(tier_name, '-') || ':' || week_points || ':'
                    || rank || ':' || rank_week_ago, ', ' order by rank, display_name)
    from public.leaderboard(current_setting('t.gv')::bigint) $$;
grant execute on function pg_temp.as_user(text), pg_temp.id(text), pg_temp.task(text), pg_temp.board()
  to authenticated;
-- n approved rows of a task for a member, reviewed `ago` ago (by tutor A)
create function pg_temp.give(p_member text, p_title text, n int, ago interval, p_note text default null) returns void
language sql as $$
  insert into submissions (guild_id, season_id, task_id, category_id, member_id, status, points_awarded, note,
                           reviewed_by, reviewed_at, created_at)
  select t.guild_id, t.season_id, t.id, t.category_id, pg_temp.id(p_member), 'approved', t.points_min, p_note,
         pg_temp.id('ta'), now() - ago, now() - ago
    from tasks t, generate_series(1, n) where t.id = pg_temp.task(p_title) $$;
create function pg_temp.pending(p_member text, p_title text) returns text language sql as $$
  insert into submissions (guild_id, season_id, task_id, category_id, member_id)
  select guild_id, season_id, id, category_id, pg_temp.id(p_member) from tasks where id = pg_temp.task(p_title)
  returning id::text $$;

do $$
declare g bigint; s bigint; w bigint; ws bigint; ca bigint; cb bigint; v record; t2 bigint; mid bigint;
begin
  insert into guilds (name, slug) values ('V Guild', 'v-guild') returning id into g;
  insert into seasons (guild_id, name, starts_on, ends_on, is_current) values (g, 'S', '2026-09-01', '2027-05-31', true) returning id into s;
  insert into guilds (name, slug) values ('W Guild', 'w-guild') returning id into w;
  insert into seasons (guild_id, name, starts_on, ends_on, is_current) values (w, 'S', '2026-09-01', '2027-05-31', true) returning id into ws;
  perform set_config('t.gv', g::text, true);
  perform set_config('t.gw', w::text, true);

  for v in select * from (values ('cap', 'd1', 'V Captain', 'captain'), ('ta', 'd2', 'V Tutor A', 'tutor'),
                                 ('tb', 'd3', 'V Tutor B', 'tutor'), ('f1', 'd4', 'V F1', 'fuksi'),
                                 ('f2', 'd5', 'V F2', 'fuksi'), ('f3', 'd6', 'V F3', 'fuksi')) x(k, u, n, r) loop
    insert into members (guild_id, season_id, user_id, email, display_name, role)
    values (g, s, ('00000000-0000-4000-8000-0000000000' || v.u)::uuid, 'v4.' || v.u || '@demo.invalid', v.n, v.r)
    returning id into mid;
    perform set_config('t.' || v.k, mid::text, true);
  end loop;
  -- an imported fuksi who has not logged in yet (user_id null) is a real guild fuksi
  insert into members (guild_id, season_id, email, display_name) values (g, s, 'v4.f4@aalto.fi', 'V F4') returning id into mid;
  perform set_config('t.f4', mid::text, true);
  insert into members (guild_id, season_id, user_id, email, display_name)
  values (w, ws, '00000000-0000-4000-8000-0000000000e1', 'v4.e1@demo.invalid', 'W F') returning id into mid;
  perform set_config('t.wf', mid::text, true);

  insert into categories (guild_id, season_id, name) values (g, s, 'CA') returning id into ca;
  insert into categories (guild_id, season_id, name) values (g, s, 'CB') returning id into cb;
  perform set_config('t.ca', ca::text, true);
  perform set_config('t.cb', cb::text, true);
  insert into tiers (guild_id, season_id, name, min_total) values (g, s, 'T1', 5);
  insert into tiers (guild_id, season_id, name, min_total) values (g, s, 'T2', 10) returning id into t2;
  -- CA >= 2 for every level; T2 (and above) also needs CB >= 3
  insert into rules (guild_id, season_id, category_id, tier_id, min_points) values (g, s, ca, null, 2), (g, s, cb, t2, 3);
  insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, max_repeats, required, requires_photo, revealed_at)
  values (g, s, ca, 'Easy', 1, 1, 20, false, false, now()),
         (g, s, cb, 'Big', 3, 3, 1, false, false, now()),
         (g, s, ca, 'Hidden req', 1, 1, 1, true, false, 'infinity'),   -- a required node nobody can see yet
         (g, s, ca, 'Retired', 1, 1, 1, false, false, now()),
         (g, s, cb, 'Secret', 1, 1, 1, false, false, 'infinity');
end $$;

-- f1: 4 Easy yesterday + the hidden required node 10 days ago + Retired an hour ago = 6 (CA), week 5 -> T1
select pg_temp.give('f1', 'Easy', 4, '1 day');
select pg_temp.give('f1', 'Hidden req', 1, '10 days');
select pg_temp.give('f1', 'Retired', 1, '1 hour');
update tasks set active = false where id = pg_temp.task('Retired');
-- f2: 6 Easy yesterday (with a private note) + the still-secret task an hour ago = 7, week 7; required node undone -> no level
select pg_temp.give('f2', 'Easy', 6, '1 day', 'private note: call me 040 123');
select pg_temp.give('f2', 'Secret', 1, '1 hour');
-- f3: everything 8 days ago, 6 Easy + Big + required = 10, week 0 -> T2 (the top level)
select pg_temp.give('f3', 'Easy', 6, '8 days');
select pg_temp.give('f3', 'Big', 1, '8 days');
select pg_temp.give('f3', 'Hidden req', 1, '8 days');
-- f4 (unclaimed): an opening balance imported today
insert into adjustments (guild_id, season_id, member_id, category_id, points, reason, created_by)
values (pg_temp.id('gv'), (select season_id from members where id = pg_temp.id('f4')), pg_temp.id('f4'), pg_temp.id('ca'),
        4, 'Opening balance', pg_temp.id('cap'));
-- staff rows: tutor B and the captain have their own (pending) submissions
select set_config('t.tbsub', pg_temp.pending('tb', 'Easy'), true);
select set_config('t.capsub', pg_temp.pending('cap', 'Easy'), true);

-- ---------- leaderboard ----------
select pg_temp.as_user('d4');   -- fuksi 1
set local role authenticated;
select is(pg_temp.board(),
          'V F3:10:T2:0:1:1, V F2:7:-:7:2:4, V F1:6:T1:5:3:3, V F4:4:-:0:4:2',
          'a fuksi sees every fuksi (unclaimed roster rows too) with name, total, level, week points, rank and rank a week ago');
select is((select count(*) from public.leaderboard(pg_temp.id('gv'))
            where member_id in (pg_temp.id('cap'), pg_temp.id('ta'), pg_temp.id('tb'))), 0::bigint, 'staff get no row');
select is((select count(*) from public.leaderboard(pg_temp.id('gv')) where member_id = pg_temp.id('wf')), 0::bigint,
          'another guild''s fuksi never appears');
select is((select tier_name from public.leaderboard(pg_temp.id('gv')) where member_id = pg_temp.id('f2')), null,
          'another fuksi with an undone (hidden) required node shows no level, not a too-high one');
select is((select week_points || ':' || total from public.leaderboard(pg_temp.id('gv')) where member_id = pg_temp.id('f4')), '0:4',
          'an opening balance created today raises total but leaves week_points = 0');
select ok((select week_points from public.leaderboard(pg_temp.id('gv')) where member_id = pg_temp.id('f4'))
          < (select max(week_points) from public.leaderboard(pg_temp.id('gv'))),
          'so the opening balance gives no MVP crown');
reset role;
update submissions set reviewed_at = now() - interval '8 days'
 where id = (select min(id) from submissions where member_id = pg_temp.id('f2') and task_id = pg_temp.task('Easy'));
set local role authenticated;
select is((select week_points || ':' || rank_week_ago from public.leaderboard(pg_temp.id('gv')) where member_id = pg_temp.id('f2')),
          '6:3', 'a point backdated 8 days leaves the week and lifts rank_week_ago (ties share a rank)');
reset role;

select pg_temp.as_user('e1');   -- W's fuksi
set local role authenticated;
select is((select array_agg(member_id) from public.leaderboard(pg_temp.id('gw'))), array[pg_temp.id('wf')],
          'another guild gets only its own rows');
reset role;
select pg_temp.as_user('d9');   -- signed in, member of nothing
set local role authenticated;
select throws_ok(format('select * from public.leaderboard(%s)', pg_temp.id('gv')), '42501', 'forbidden',
                 'a non-member cannot read the leaderboard');
select throws_ok(format('select * from public.activity(%s)', pg_temp.id('gv')), '42501', 'forbidden',
                 'a non-member cannot read the activity feed');
reset role;
select ok(not has_function_privilege('anon', 'public.leaderboard(bigint)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.activity(bigint,int)', 'EXECUTE'),
          'anon can execute neither leaderboard nor activity');

-- ---------- activity ----------
select pg_temp.as_user('d4');
set local role authenticated;
select is((select count(*) from public.activity(pg_temp.id('gv')) where secret and task_title is null
            and member_id = pg_temp.id('f2') and points = 1), 1::bigint, 'activity hides the title of an unrevealed task');
select is((select count(*) from public.activity(pg_temp.id('gv')) where task_title = 'Secret'), 0::bigint,
          'the secret title never leaks');
select is((select count(*) from public.activity(pg_temp.id('gv')) a where a::text like '%private note%'), 0::bigint,
          'activity never carries notes');
select is((select count(*) from public.activity(pg_temp.id('gv')) where task_title = 'Retired'), 0::bigint,
          'activity skips inactive tasks');
select is((select count(*) from public.activity(pg_temp.id('gv')) where member_id = pg_temp.id('f3')), 0::bigint,
          'activity covers the last 7 days only');
select is((select count(*) from public.activity(pg_temp.id('gv'), 1000)), 10::bigint,
          'activity returns every row of the week (5 Easy of f2, 4 Easy of f1, the secret)');
select is((select count(*) from public.activity(pg_temp.id('gv'), 0)), 1::bigint, 'the limit is clamped to at least 1');
reset role;
select is((select proargnames from pg_proc where oid = 'public.activity(bigint,int)'::regprocedure),
          array['p_guild_id','p_limit','at','member_id','display_name','category_id','task_title','points','secret'],
          'activity returns exactly its 7 documented columns');

-- ---------- roadmap().next_tier ----------
select pg_temp.as_user('d4');
set local role authenticated;
select is(public.roadmap(pg_temp.id('gv')) -> 'next_tier',
          jsonb_build_object('tier_id', (select id from public.tiers where name = 'T2' and guild_id = pg_temp.id('gv')), 'name', 'T2',
                             'points_needed', 4, 'unmet', jsonb_build_array(jsonb_build_object('category_id', pg_temp.id('cb'), 'have', 0, 'need', 3)),
                             'required_missing', 0),
          'next_tier: points still needed and the tier-scoped CB rule is unmet');
reset role;
select pg_temp.as_user('d5');   -- f2: enough points, but the hidden required node is undone
set local role authenticated;
select is((public.roadmap(pg_temp.id('gv')) -> 'next_tier') - 'tier_id',
          '{"name": "T1", "points_needed": 0, "unmet": [], "required_missing": 1}'::jsonb,
          'next_tier counts a hidden required node without naming it');
reset role;
select pg_temp.as_user('d6');   -- f3: top level
set local role authenticated;
select is(public.roadmap(pg_temp.id('gv')) -> 'next_tier', 'null'::jsonb, 'next_tier is null at the top level');
reset role;

-- parity: for every fuksi who can log in (seeded + fixtures), next_tier is null exactly at the top level, and a
-- non-null next_tier is never already reached (that would mean the two predicates disagree)
create function pg_temp.parity_violations() returns int language plpgsql as $$
declare m record; nt jsonb; top bigint; mine bigint; bad int := 0;
begin
  for m in select * from members where role = 'fuksi' and user_id is not null
            and season_id = public.current_season(guild_id) loop
    perform set_config('request.jwt.claim.sub', m.user_id::text, true);
    nt := public.roadmap(m.guild_id) -> 'next_tier';
    top := (select id from tiers where guild_id = m.guild_id and season_id = m.season_id order by min_total desc limit 1);
    mine := (select tier_id from member_tier where member_id = m.id);
    if (jsonb_typeof(nt) = 'null') <> (mine is not distinct from top)
       or (jsonb_typeof(nt) = 'object' and jsonb_array_length(nt -> 'unmet') = 0
           and (nt ->> 'required_missing')::int = 0 and (nt ->> 'points_needed')::int <= 0) then
      bad := bad + 1;
    end if;
  end loop;
  return bad;
end $$;
select is(pg_temp.parity_violations(), 0, 'next_tier and member_tier agree for every seeded fuksi');
select ok((select count(*) from members where role = 'fuksi' and user_id is not null) >= 6, 'the parity check walked the seeded fuksis');

-- ---------- RLS: tutors see guild fuksis only ----------
select pg_temp.as_user('d2');   -- tutor A
set local role authenticated;
select is((select count(*) from public.submissions where member_id in (pg_temp.id('tb'), pg_temp.id('cap'))), 0::bigint,
          'a tutor cannot select another tutor''s or the captain''s submissions');
select ok((select count(*) from public.submissions where member_id = pg_temp.id('f2')) > 0, 'but sees every guild fuksi''s');
reset role;

-- ---------- shared queue: collisions are per-row results ----------
select set_config('t.p1', pg_temp.pending('f1', 'Easy'), true);
select set_config('t.p2', pg_temp.pending('f1', 'Easy'), true);
select set_config('t.p3', pg_temp.pending('f1', 'Easy'), true);
select pg_temp.as_user('d3');   -- tutor B gets to p1 first
set local role authenticated;
select is((select result from public.review_submissions(array[pg_temp.id('p1')], true)), 'ok', 'tutor B approves one row');
reset role;
select pg_temp.as_user('d2');   -- tutor A approves all three
set local role authenticated;
select is((select array_agg(result order by submission_id)
             from public.review_submissions(array[pg_temp.id('p1'), pg_temp.id('p2'), pg_temp.id('p3')], true)),
          array['already_reviewed', 'ok', 'ok'], 'a mixed batch: 2 ok + 1 already_reviewed');
select is((select string_agg(status || ':' || (reviewed_by = pg_temp.id('tb'))::text, ',' order by id) from public.submissions
            where id in (pg_temp.id('p1'), pg_temp.id('p2'), pg_temp.id('p3'))),
          'approved:true,approved:false,approved:false', 'nothing rolled back, and the first row keeps tutor B as reviewer');
reset role;
select set_config('t.q1', pg_temp.pending('f1', 'Easy'), true);
select set_config('t.q2', pg_temp.pending('f1', 'Easy'), true);
select pg_temp.as_user('d3');
set local role authenticated;
select is((select result from public.review_submissions(array[pg_temp.id('q1')], true)), 'ok', 'tutor B approves q1');
reset role;
select pg_temp.as_user('d2');
set local role authenticated;
select is((select array_agg(result order by submission_id) from public.review_submissions(array[pg_temp.id('q1'), pg_temp.id('q2')], false)),
          array['already_reviewed', 'rejected'], 'a reject batch: rejected + already_reviewed');
reset role;
select set_config('t.r1', pg_temp.pending('f1', 'Easy'), true);
select pg_temp.as_user('d2');
set local role authenticated;
select throws_ok(format('select * from public.review_submissions(array[%s, %s], true)', pg_temp.id('r1'), pg_temp.id('capsub')),
                 '42501', 'forbidden', 'a batch with a row the caller may not review (the captain''s) still raises forbidden');
reset role;
select is((select status from submissions where id = pg_temp.id('r1')), 'pending', 'and changes nothing');

-- ---------- roles: set_role(bigint, text); a promoted fuksi cannot review their own row ----------
select set_config('t.f2sub', pg_temp.pending('f2', 'Easy'), true);
select pg_temp.as_user('d1');   -- captain
set local role authenticated;
select lives_ok(format('select public.set_role(%s, %L)', pg_temp.id('f2'), 'tutor'), 'set_role(bigint, text) promotes a fuksi');
reset role;
select pg_temp.as_user('d5');   -- f2, now a tutor
set local role authenticated;
select throws_ok(format('select * from public.review_submissions(array[%s], true)', pg_temp.id('f2sub')), '42501', 'forbidden',
                 'a fuksi promoted to tutor cannot review their own pending row');
reset role;
select is(to_regprocedure('public.set_role(bigint,text,bigint)'), null, 'the 3-argument set_role is gone');

-- ---------- tutor groups are gone ----------
select is(to_regclass('public.tutor_groups'), null, 'tutor_groups no longer exists');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc ~* 'tutor_group'), 0::bigint,
          'no function body still mentions tutor_group');

select * from finish();
rollback;
