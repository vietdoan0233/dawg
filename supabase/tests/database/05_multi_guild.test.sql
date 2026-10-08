-- Guild-agnostic behaviour: two guilds with different structures run side by side (SDD §10).
-- Generic fixtures only; nothing here depends on the demo dataset.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'mg.shared@demo.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', 'mg.captain.one@demo.invalid'),
  ('00000000-0000-4000-8000-0000000000b3', 'mg.captain.two@demo.invalid');

create function pg_temp.guild(n int) returns void language plpgsql as $$
declare g bigint; s bigint;
begin
  insert into guilds (name, slug) values ('Guild ' || n, 'guild-' || n) returning id into g;
  insert into seasons (guild_id, name, starts_on, ends_on, is_current)
  values (g, 'S', '2026-09-01', '2027-05-31', true) returning id into s;
  perform set_config('t.g' || n, g::text, true);
  perform set_config('t.s' || n, s::text, true);
end $$;
create function pg_temp.cat(n int, p_name text, p_color text, p_icon text) returns bigint language sql as $$
  insert into categories (guild_id, season_id, name, color, icon)
  values (current_setting('t.g' || n)::bigint, current_setting('t.s' || n)::bigint, p_name, p_color, p_icon) returning id $$;
create function pg_temp.task(n int, p_cat bigint, p_title text, lo int, hi int) returns bigint language sql as $$
  insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, requires_photo)
  values (current_setting('t.g' || n)::bigint, current_setting('t.s' || n)::bigint, p_cat, p_title, lo, hi, false) returning id $$;
create function pg_temp.tier(n int, p_name text, p_min int) returns bigint language sql as $$
  insert into tiers (guild_id, season_id, name, min_total)
  values (current_setting('t.g' || n)::bigint, current_setting('t.s' || n)::bigint, p_name, p_min) returning id $$;
create function pg_temp.member(n int, p_user uuid, p_email text, p_name text, p_role text) returns bigint language sql as $$
  insert into members (guild_id, season_id, user_id, email, display_name, role)
  values (current_setting('t.g' || n)::bigint, current_setting('t.s' || n)::bigint, p_user, p_email, p_name, p_role) returning id $$;

-- ---------- two guilds with different structures ----------
do $$
declare beta bigint;
begin
  perform pg_temp.guild(1);
  perform pg_temp.guild(2);

  -- guild 1: 3 tracks + a shared name, 2 levels, one category minimum
  perform set_config('t.c1a', pg_temp.cat(1, 'Alpha', '#112233', 'star')::text, true);
  beta := pg_temp.cat(1, 'Beta', '#223344', 'book');
  perform pg_temp.cat(1, 'Gamma', '#334455', 'flag');
  perform pg_temp.cat(1, 'Shared', '#000000', 'hex');
  perform set_config('t.t1a', pg_temp.task(1, current_setting('t.c1a')::bigint, 'Alpha task', 3, 3)::text, true);
  perform pg_temp.task(1, beta, 'Beta task', 1, 1);
  perform set_config('t.bronze', pg_temp.tier(1, 'Bronze', 5)::text, true);
  perform pg_temp.tier(1, 'Silver', 10);
  insert into rules (guild_id, season_id, category_id, min_points)
  values (current_setting('t.g1')::bigint, current_setting('t.s1')::bigint, current_setting('t.c1a')::bigint, 2);

  -- guild 2: 7 tracks (more than any fixed palette), one level, no minimums
  for i in 1..7 loop
    perform pg_temp.cat(2, 'Track ' || i, '#' || lpad(to_hex(i * 2000000), 6, '0'),
                        (array['cog','bell','goblet','tower','shield','hex','star'])[i]);
  end loop;
  perform pg_temp.cat(2, 'Shared', '#000000', 'hex');
  perform set_config('t.t2', pg_temp.task(2, (select id from categories where name = 'Track 7' and guild_id = current_setting('t.g2')::bigint),
                                          'Track task', 1, 2)::text, true);
  perform pg_temp.tier(2, 'Level X', 100);

  perform set_config('t.m1', pg_temp.member(1, '00000000-0000-4000-8000-0000000000b1', 'mg.shared@demo.invalid', 'Shared fuksi', 'fuksi')::text, true);
  perform set_config('t.m2', pg_temp.member(2, '00000000-0000-4000-8000-0000000000b1', 'mg.shared@demo.invalid', 'Shared fuksi', 'fuksi')::text, true);
  perform pg_temp.member(1, '00000000-0000-4000-8000-0000000000b2', 'mg.captain.one@demo.invalid', 'Captain one', 'captain');
  perform pg_temp.member(2, '00000000-0000-4000-8000-0000000000b3', 'mg.captain.two@demo.invalid', 'Captain two', 'captain');
end $$;

select is((select count(*) from categories where name = 'Shared'), 2::bigint, 'two guilds may use the same category name');

-- ---------- a member of both guilds sees each map separately ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
select is((select count(*) from public.guilds), 2::bigint, 'a member of two guilds sees both');
select is((select string_agg(c ->> 'name', ',' order by o) from jsonb_array_elements(public.roadmap(current_setting('t.g1')::bigint) -> 'categories') with ordinality t(c, o)),
          'Alpha,Beta,Gamma,Shared', 'guild 1 map: its own 4 categories in id order');
select is((select string_agg(c ->> 'name', ',' order by o) from jsonb_array_elements(public.roadmap(current_setting('t.g1')::bigint) -> 'tiers') with ordinality t(c, o)),
          'Bronze,Silver', 'guild 1 map: its own levels');
select is((select string_agg(n ->> 'title', ',' order by o) from jsonb_array_elements(public.roadmap(current_setting('t.g1')::bigint) -> 'nodes') with ordinality t(n, o)),
          'Alpha task,Beta task', 'guild 1 map: only its own nodes');
select is((select count(*) from jsonb_array_elements(public.roadmap(current_setting('t.g2')::bigint) -> 'categories') c), 8::bigint,
          'guild 2 map: 7 tracks + 1 shared name, no fixed track count');
select is((select c ->> 'color' || ' ' || (c ->> 'icon') from jsonb_array_elements(public.roadmap(current_setting('t.g2')::bigint) -> 'categories') c
            where c ->> 'name' = 'Track 7'), '#d59f80 star', 'guild 2 map: the 7th track carries its stored colour and icon');
select is((select string_agg(c ->> 'name', ',') from jsonb_array_elements(public.roadmap(current_setting('t.g2')::bigint) -> 'tiers') c),
          'Level X', 'guild 2 map: its own single level');
select is((select string_agg(n ->> 'title', ',') from jsonb_array_elements(public.roadmap(current_setting('t.g2')::bigint) -> 'nodes') n),
          'Track task', 'guild 2 map: only its own node');

-- ---------- progress, review and levels stay inside their guild ----------
select set_config('t.sub1', public.submit_task(current_setting('t.t1a')::bigint)::text, true);
select is((select n ->> 'status' from jsonb_array_elements(public.roadmap(current_setting('t.g1')::bigint) -> 'nodes') n where n ->> 'title' = 'Alpha task'),
          'pending', 'a submission half-lights the node in its own guild');
select is((select n ->> 'status' from jsonb_array_elements(public.roadmap(current_setting('t.g2')::bigint) -> 'nodes') n where n ->> 'title' = 'Track task'),
          'dim', 'and does not touch the other guild''s map');
select set_config('t.sub2', public.submit_task(current_setting('t.t2')::bigint)::text, true);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);   -- captain of guild 1 only
set local role authenticated;
select throws_ok(format('select public.roadmap(%s)', current_setting('t.g2')), '42501', 'forbidden',
                 'a captain of one guild cannot open another guild''s map');
select throws_ok(format('select * from public.review_submissions(array[%s], true, 2, ''r'')', current_setting('t.sub2')),
                 '42501', 'forbidden', 'a captain of one guild cannot review another guild''s submission');
select is((select result from public.review_submissions(array[current_setting('t.sub1')::bigint], true)), 'ok',
          'but reviews their own guild''s');

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
select is((public.roadmap(current_setting('t.g1')::bigint) ->> 'total')::int, 3, 'guild 1 total counts only guild 1 points');
select is((public.roadmap(current_setting('t.g2')::bigint) ->> 'total')::int, 0, 'guild 2 total is unaffected');

reset role;
insert into adjustments (guild_id, season_id, member_id, category_id, points, reason)
values (current_setting('t.g1')::bigint, current_setting('t.s1')::bigint, current_setting('t.m1')::bigint, current_setting('t.c1a')::bigint, 2, 'test');
set local role authenticated;
select is((public.roadmap(current_setting('t.g1')::bigint) ->> 'own_tier_id')::bigint, current_setting('t.bronze')::bigint,
          '5p with the minimum met reaches guild 1''s Bronze');
select is(public.roadmap(current_setting('t.g2')::bigint) ->> 'own_tier_id', null, 'and no level in guild 2');
select is((select total from public.leaderboard(current_setting('t.g1')::bigint) where member_id = current_setting('t.m1')::bigint),
          5, 'guild 1 leaderboard counts guild 1 points');
select is((select array_agg(member_id::text || ':' || total) from public.leaderboard(current_setting('t.g2')::bigint)),
          array[current_setting('t.m2') || ':0'], 'guild 2 leaderboard has only its own fuksi, none of guild 1''s members');

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b3', true);   -- captain of guild 2 only
set local role authenticated;
select is((select result from public.review_submissions(array[current_setting('t.sub2')::bigint], true, 2, 'a reason')), 'ok',
          'the other guild''s captain reviews their own submission');
select is((select count(*) from public.submissions where guild_id = current_setting('t.g1')::bigint)
          + (select count(*) from public.tasks where guild_id = current_setting('t.g1')::bigint), 0::bigint,
          'and cannot read guild 1''s submissions or nodes');

select * from finish();
rollback;
