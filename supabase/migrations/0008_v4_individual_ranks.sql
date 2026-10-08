-- 0008_v4_individual_ranks.sql: SDD §11.1, v4. Individual leaderboard, no tutor groups, fuksi home data.
-- No new tables. Every tutor of a guild reviews every fuksi of that guild (ADR-7). Levels, totals and names are
-- public inside the guild. Accepted widening (Security): any guild tutor now sees every guild FUKSI's submissions
-- and proof photos (never staff rows, never their own, never another guild's).

-- ---------- 1. is_tutor_of: any tutor of the guild, of fuksis only ----------
-- Same name and signature, so its six callers (submissions_select, adjustments_select, proofs_select,
-- review_submissions, duplicate_photos, required_missing) switch with no other edit.
create or replace function public.is_tutor_of(p_member_id bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.members me
    join public.members tgt on tgt.guild_id = me.guild_id and tgt.season_id = me.season_id
    where me.user_id = auth.uid() and me.role = 'tutor'
      and me.season_id = public.current_season(me.guild_id)
      and tgt.id = p_member_id and tgt.role = 'fuksi' and tgt.id <> me.id)
$$;

-- ---------- 2. required_missing: any member of the guild ----------
-- leaderboard() is a definer but auth.uid() is still the caller, so the old self/captain/tutor clause made
-- member_tier show a too-high level for everyone else. Levels are public now; the boolean leaks nothing new.
create or replace function public.required_missing(p_member_id bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.tasks t on t.guild_id = m.guild_id and t.season_id = m.season_id
    where m.id = p_member_id
      and public.is_member(m.guild_id)
      and t.required and t.active
      and not exists (select 1 from public.submissions s
                      where s.member_id = m.id and s.task_id = t.id and s.status = 'approved'))
$$;

-- ---------- 3. leaderboard: one row per fuksi of the current season ----------
-- Includes unclaimed roster rows (imported fuksis with opening balances). Staff and other guilds never appear.
-- "Week" = rolling 7 days of approved submissions by coalesce(reviewed_at, created_at); adjustments count in
-- total (and so in the week-ago baseline) but never in week_points.
-- ponytail: member_tier runs once per fuksi; cache totals in a table award_task maintains when a guild breaks the
-- 50 ms gate (SDD §11.1 Cost).
drop function public.leaderboard(bigint);
create function public.leaderboard(p_guild_id bigint)
returns table (member_id bigint, display_name text, total int, tier_name text, week_points int, rank int, rank_week_ago int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_member(p_guild_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    with f as (
      select m.id, m.display_name from public.members m
       where m.guild_id = p_guild_id and m.season_id = public.current_season(p_guild_id) and m.role = 'fuksi'),
    x as (
      select f.id, f.display_name,
             coalesce((select sum(p.points) from public.progress p where p.member_id = f.id), 0)::int as tot,
             tr.name as tier,
             coalesce((select sum(s.points_awarded) from public.submissions s
                        where s.member_id = f.id and s.status = 'approved'
                          and coalesce(s.reviewed_at, s.created_at) >= now() - interval '7 days'), 0)::int as wk
        from f
        left join lateral (select mt.tier_id from public.member_tier mt where mt.member_id = f.id) mt on true
        left join public.tiers tr on tr.id = mt.tier_id)
    select x.id, x.display_name, x.tot, x.tier, x.wk,
           (rank() over (order by x.tot desc))::int,
           (rank() over (order by x.tot - x.wk desc))::int
      from x
     order by 6, 2;
end $$;

-- ---------- 4. activity: the guild's feed of the last 7 days ----------
-- Approved submissions of fuksis on active tasks. Never a note, photo, award reason or reviewer. A task that is
-- still secret shows no title (secret = true).
create function public.activity(p_guild_id bigint, p_limit int default 20)
returns table (at timestamptz, member_id bigint, display_name text, category_id bigint, task_title text, points int, secret boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_member(p_guild_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select coalesce(s.reviewed_at, s.created_at), m.id, m.display_name, s.category_id,
           case when t.revealed_at > now() then null else t.title end,
           s.points_awarded, t.revealed_at > now()
      from public.submissions s
      join public.members m on m.id = s.member_id
      join public.tasks t on t.id = s.task_id
     where s.guild_id = p_guild_id and s.season_id = public.current_season(p_guild_id)
       and s.status = 'approved' and m.role = 'fuksi' and t.active
       and coalesce(s.reviewed_at, s.created_at) >= now() - interval '7 days'
     order by coalesce(s.reviewed_at, s.created_at) desc, s.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- ---------- 4b. roadmap: + next_tier ----------
-- next_tier = the lowest tier above the member's current one, with what is still missing, computed with
-- member_tier's predicate (r.tier_id is null or rt.min_total <= t.min_total, plus required nodes). null at the top.
-- required_missing counts undone required nodes, hidden ones included, without saying which.
-- ponytail: the tier predicate lives here and in member_tier (pgTAP 10_v4 holds them in parity); extract a
-- tier_gap(member, tier) helper when a third caller appears.
create or replace function public.roadmap(p_guild_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me bigint := public.my_member_id(p_guild_id);
  s bigint := public.current_season(p_guild_id);
  v_total int;
  v_tier bigint;
begin
  if me is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_total := (select coalesce(sum(points), 0) from public.progress where member_id = me);
  v_tier := (select tier_id from public.member_tier where member_id = me);
  return jsonb_build_object(
    'member_id', me,
    'total', v_total,
    'own_tier_id', v_tier,
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'min_total', t.min_total)
                                        order by t.min_total), '[]')
                from public.tiers t where t.guild_id = p_guild_id and t.season_id = s),
    'next_tier', (
      select jsonb_build_object(
               'tier_id', t.id, 'name', t.name,
               'points_needed', greatest(t.min_total - v_total, 0),
               'unmet', (select coalesce(jsonb_agg(jsonb_build_object('category_id', u.category_id, 'have', u.have, 'need', u.need)
                                                   order by u.category_id), '[]')
                           from (select r.category_id, max(r.min_points) as need,
                                        (select coalesce(sum(p.points), 0) from public.progress p
                                          where p.member_id = me and p.category_id = r.category_id)::int as have
                                   from public.rules r
                                   left join public.tiers rt on rt.id = r.tier_id
                                  where r.guild_id = p_guild_id and r.season_id = s
                                    and (r.tier_id is null or rt.min_total <= t.min_total)
                                  group by r.category_id) u
                          where u.have < u.need),
               'required_missing', (select count(*)::int from public.tasks rq
                                     where rq.guild_id = p_guild_id and rq.season_id = s and rq.required and rq.active
                                       and not exists (select 1 from public.submissions x
                                                        where x.member_id = me and x.task_id = rq.id and x.status = 'approved')))
        from public.tiers t
       where t.guild_id = p_guild_id and t.season_id = s
         and t.min_total > coalesce((select ct.min_total from public.tiers ct where ct.id = v_tier), 0)
       order by t.min_total
       limit 1),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', c.id, 'name', c.name, 'color', c.color, 'icon', c.icon,
                      'points', coalesce((select sum(p.points) from public.progress p
                                           where p.member_id = me and p.category_id = c.id), 0),
                      'min_points', (select min(r.min_points) from public.rules r where r.category_id = c.id))
                    order by c.id), '[]')
                from public.categories c where c.guild_id = p_guild_id and c.season_id = s),
    'nodes', (select coalesce(jsonb_agg(
                case when public.task_visible(t.id) then jsonb_build_object(
                  'id', t.id, 'category_id', t.category_id, 'locked', false,
                  'title', t.title, 'description', t.description,
                  'points_min', t.points_min, 'points_max', t.points_max,
                  'reviewer', t.reviewer, 'max_repeats', t.max_repeats, 'required', t.required,
                  'requires_photo', t.requires_photo, 'requires_note', t.requires_note,
                  'approved', a.approved, 'pending', a.pending,
                  'status', case when a.approved > 0 then 'lit' when a.pending > 0 then 'pending' else 'dim' end)
                else jsonb_build_object('category_id', t.category_id, 'locked', true) end
                order by t.id), '[]')
                from public.tasks t
                cross join lateral (
                  select count(*) filter (where x.status = 'approved')::int as approved,
                         count(*) filter (where x.status = 'pending')::int as pending
                  from public.submissions x where x.member_id = me and x.task_id = t.id) a
               where t.guild_id = p_guild_id and t.season_id = s and t.active));
end $$;

-- ---------- 4c. review_submissions: a collision is a per-row result, not a rollback ----------
-- One shared queue per guild: a row another tutor already reviewed returns 'already_reviewed' and the batch
-- goes on. A missing id, an id the caller may not review, or an old-season row still raises 'forbidden' for the
-- whole batch. Per-row result: ok | limit_reached | rejected | already_reviewed.
create or replace function public.review_submissions(
  p_ids bigint[], p_approve boolean, p_points int default null, p_reason text default null)
returns table (submission_id bigint, result text)
language plpgsql security definer set search_path = ''
as $$
declare
  s public.submissions;
  t public.tasks;
  v_id bigint;
  v_ids bigint[];
  v_status text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_approve is null or cardinality(p_ids) > 200 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- one lock per (member, task), taken in (task, member) order so concurrent batches cannot deadlock;
  -- a missing id and an id the caller may not review look the same
  v_ids := array(select x.id from public.submissions x where x.id = any (p_ids) order by x.task_id, x.member_id, x.id);
  if cardinality(v_ids) <> (select count(distinct i) from unnest(coalesce(p_ids, '{}')) i) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  foreach v_id in array v_ids loop
    select * into s from public.submissions where id = v_id;
    select * into t from public.tasks where id = s.task_id;
    if s.season_id <> public.current_season(s.guild_id)
       or not (public.has_role(s.guild_id, array['captain'])
               or (t.reviewer = 'tutor' and public.is_tutor_of(s.member_id))) then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    -- same lock as submit_task/award_task, then re-read: a concurrent review may have won
    perform pg_advisory_xact_lock(hashtextextended(s.member_id::text || ':' || s.task_id::text, 0));
    select x.status into v_status from public.submissions x where x.id = v_id;
    if v_status <> 'pending' then
      submission_id := v_id; result := 'already_reviewed';
      return next;
      continue;
    end if;

    if p_approve then
      submission_id := s.id;
      result := public.award_task(s.member_id, s.task_id, coalesce(p_points, t.points_min), p_reason,
                                  'submission', null, public.my_member_id(s.guild_id), s.id);
      return next;
    else
      update public.submissions
         set status = 'rejected', reviewed_by = public.my_member_id(s.guild_id), reviewed_at = now()
       where id = s.id and status = 'pending';
      submission_id := s.id;
      result := case when found then 'rejected' else 'already_reviewed' end;
      return next;
    end if;
  end loop;
end $$;

-- ---------- 5. set_role without a group ----------
drop function public.set_role(bigint, text, bigint);
-- The only way to change a role. A captain cannot change their own row, so a guild never loses its last captain.
create function public.set_role(p_member_id bigint, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.members;
begin
  select * into m from public.members where id = p_member_id;
  if m.id is null or m.season_id <> public.current_season(m.guild_id)
     or not public.has_role(m.guild_id, array['captain']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.id = public.my_member_id(m.guild_id) then raise exception 'cannot_change_self' using errcode = '42501'; end if;
  -- Two captains demoting each other at once: lock the guild's captains, then re-check. The loser finds they are
  -- no longer captain. With cannot_change_self, a guild always keeps at least one captain.
  perform 1 from public.members c
   where c.guild_id = m.guild_id and c.season_id = m.season_id and c.role = 'captain' order by c.id for update;
  if not public.has_role(m.guild_id, array['captain']) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.members set role = p_role where id = m.id;   -- the role CHECK rejects a bad role
end $$;

-- ---------- 6. import_apply without groups ----------
-- 0006's body minus the group lookup/insert. A "tutor_group_name" key is now ignored (not in the column list).
create or replace function public.import_apply(
  p_guild_id bigint,
  p_categories jsonb,    -- [{ name, color?, icon? }]
  p_tasks jsonb,         -- [{ category_name, title, description?, points_min, points_max?, reviewer?, max_repeats?, required?, requires_photo?, requires_note?, revealed_at?, active? }]
  p_tiers jsonb,         -- [{ name, min_total }]
  p_rules jsonb,         -- [{ category_name, tier_name?, min_points }]
  p_members jsonb,       -- [{ email, display_name }]
  p_adjustments jsonb    -- [{ email, category_name, points, reason? }]
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_season bigint;
  v_me bigint;
  v_cat bigint;
  v_tier bigint;
  v_member bigint;
  r record;
  n int;
  c_categories int := 0; c_tasks int := 0; c_tiers int := 0; c_rules int := 0; c_members int := 0; c_adjustments int := 0;
begin
  if not public.has_role(p_guild_id, array['captain']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('import:' || p_guild_id, 0));
  v_season := public.current_season(p_guild_id);
  v_me := public.my_member_id(p_guild_id);

  for r in select * from jsonb_to_recordset(coalesce(p_categories, '[]')) as x(name text, color text, icon text) loop
    insert into public.categories (guild_id, season_id, name, color, icon)
    values (p_guild_id, v_season, trim(r.name), coalesce(lower(r.color), '#888888'), coalesce(r.icon, 'hex'))
    on conflict (guild_id, season_id, name) do nothing;
    get diagnostics n = row_count; c_categories := c_categories + n;
  end loop;

  for r in select * from jsonb_to_recordset(coalesce(p_tiers, '[]')) as x(name text, min_total int) loop
    insert into public.tiers (guild_id, season_id, name, min_total)
    values (p_guild_id, v_season, trim(r.name), r.min_total)
    on conflict do nothing;   -- same name or same min_total = already there
    get diagnostics n = row_count; c_tiers := c_tiers + n;
  end loop;

  for r in select * from jsonb_to_recordset(coalesce(p_tasks, '[]')) as x(
      category_name text, title text, description text, points_min int, points_max int, reviewer text,
      max_repeats int, required boolean, requires_photo boolean, requires_note boolean,
      revealed_at timestamptz, active boolean) loop
    select id into v_cat from public.categories
     where guild_id = p_guild_id and season_id = v_season and lower(name) = lower(trim(r.category_name)) order by id limit 1;
    if v_cat is null then raise exception 'category_not_found: %', r.category_name using errcode = '22023'; end if;
    -- no unique key on tasks: same title in the same category = already imported
    if not exists (select 1 from public.tasks where guild_id = p_guild_id and season_id = v_season
                    and category_id = v_cat and lower(title) = lower(trim(r.title))) then
      insert into public.tasks (guild_id, season_id, category_id, title, description, points_min, points_max,
                                reviewer, max_repeats, required, requires_photo, requires_note, revealed_at, active)
      values (p_guild_id, v_season, v_cat, trim(r.title), r.description, r.points_min, coalesce(r.points_max, r.points_min),
              coalesce(r.reviewer, 'tutor'), coalesce(r.max_repeats, 1), coalesce(r.required, false),
              coalesce(r.requires_photo, true), coalesce(r.requires_note, false),
              coalesce(r.revealed_at, now()), coalesce(r.active, true));
      c_tasks := c_tasks + 1;
    end if;
  end loop;

  for r in select * from jsonb_to_recordset(coalesce(p_rules, '[]')) as x(category_name text, tier_name text, min_points int) loop
    continue when coalesce(r.min_points, 0) <= 0;   -- SDD: 0-minimum rules are skipped
    select id into v_cat from public.categories
     where guild_id = p_guild_id and season_id = v_season and lower(name) = lower(trim(r.category_name)) order by id limit 1;
    if v_cat is null then raise exception 'category_not_found: %', r.category_name using errcode = '22023'; end if;
    v_tier := null;
    if r.tier_name is not null then
      select id into v_tier from public.tiers
       where guild_id = p_guild_id and season_id = v_season and lower(name) = lower(trim(r.tier_name)) order by id limit 1;
      if v_tier is null then raise exception 'tier_not_found: %', r.tier_name using errcode = '22023'; end if;
    end if;
    insert into public.rules (guild_id, season_id, category_id, tier_id, min_points)
    values (p_guild_id, v_season, v_cat, v_tier, r.min_points)
    on conflict (guild_id, season_id, category_id, tier_id) do nothing;
    get diagnostics n = row_count; c_rules := c_rules + n;
  end loop;

  for r in select * from jsonb_to_recordset(coalesce(p_members, '[]')) as x(email text, display_name text) loop
    if r.email is null or trim(r.email) !~* '^[^@\s]+@aalto\.fi$' then
      raise exception 'invalid_email: %', r.email using errcode = '22023';
    end if;
    -- roster rows are always fuksis; a row someone already claimed (user_id set) is left alone
    insert into public.members (guild_id, season_id, email, display_name, role)
    values (p_guild_id, v_season, trim(r.email)::extensions.citext,
            coalesce(nullif(trim(r.display_name), ''), split_part(trim(r.email), '@', 1)), 'fuksi')
    on conflict (guild_id, season_id, email) do update
      set display_name = excluded.display_name
      where public.members.user_id is null;
    get diagnostics n = row_count; c_members := c_members + n;
  end loop;

  for r in select * from jsonb_to_recordset(coalesce(p_adjustments, '[]')) as x(email text, category_name text, points int, reason text) loop
    continue when coalesce(r.points, 0) = 0;
    select id into v_member from public.members
     where guild_id = p_guild_id and season_id = v_season and email = trim(r.email)::extensions.citext;
    if v_member is null then raise exception 'member_not_found: %', r.email using errcode = '22023'; end if;
    select id into v_cat from public.categories
     where guild_id = p_guild_id and season_id = v_season and lower(name) = lower(trim(r.category_name)) order by id limit 1;
    if v_cat is null then raise exception 'category_not_found: %', r.category_name using errcode = '22023'; end if;
    -- a re-import must not double an opening balance; to correct one, use add_adjustment
    if not exists (select 1 from public.adjustments where guild_id = p_guild_id and season_id = v_season
                    and member_id = v_member and category_id = v_cat
                    and reason = coalesce(r.reason, 'Opening balance')) then
      insert into public.adjustments (guild_id, season_id, member_id, category_id, points, reason, created_by)
      values (p_guild_id, v_season, v_member, v_cat, r.points, coalesce(r.reason, 'Opening balance'), v_me);
      c_adjustments := c_adjustments + 1;
    end if;
  end loop;

  return jsonb_build_object('categories', c_categories, 'tasks', c_tasks, 'tiers', c_tiers,
                            'rules', c_rules, 'members', c_members, 'adjustments', c_adjustments);
end $$;

-- ---------- 7. drop groups ----------
-- The column's FK, index and column grant go with it; the table's policy and grant go with the table.
alter table public.members drop column tutor_group_id;
drop table public.tutor_groups;

-- ---------- 8. grants ----------
revoke all on function public.leaderboard(bigint), public.activity(bigint, int), public.set_role(bigint, text)
  from public, anon;
grant execute on function public.leaderboard(bigint), public.activity(bigint, int), public.set_role(bigint, text)
  to authenticated;
