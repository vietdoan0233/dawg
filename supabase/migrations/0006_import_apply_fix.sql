-- 0006_import_apply_fix.sql: make slice 5 import work and re-runnable (review of 0004/0005).
-- - import_history goes: it had no RLS (cross-guild read) and made a typo a season-long lockout.
--   Re-import is instead idempotent: existing categories/tiers/rules/tasks/members/balances are skipped.
-- - csv_escape_formula goes: export escapes in the browser (lib/csv.ts); nothing called it.
-- - import_apply: jsonb_to_recordset, column defaults for omitted keys, case-insensitive tutor groups,
--   roster rows always join as 'fuksi' (staff roles go through set_role).

drop table public.import_history;
drop function public.csv_escape_formula(text);
drop function public.import_apply(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);

create function public.import_apply(
  p_guild_id bigint,
  p_categories jsonb,    -- [{ name, color?, icon? }]
  p_tasks jsonb,         -- [{ category_name, title, description?, points_min, points_max?, reviewer?, max_repeats?, required?, requires_photo?, requires_note?, revealed_at?, active? }]
  p_tiers jsonb,         -- [{ name, min_total }]
  p_rules jsonb,         -- [{ category_name, tier_name?, min_points }]
  p_members jsonb,       -- [{ email, display_name, tutor_group_name? }]
  p_adjustments jsonb    -- [{ email, category_name, points, reason? }]
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_season bigint;
  v_me bigint;
  v_cat bigint;
  v_tier bigint;
  v_group bigint;
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

  for r in select * from jsonb_to_recordset(coalesce(p_members, '[]')) as x(email text, display_name text, tutor_group_name text) loop
    if r.email is null or trim(r.email) !~* '^[^@\s]+@aalto\.fi$' then
      raise exception 'invalid_email: %', r.email using errcode = '22023';
    end if;
    v_group := null;
    if nullif(trim(r.tutor_group_name), '') is not null then
      select id into v_group from public.tutor_groups
       where guild_id = p_guild_id and season_id = v_season and lower(name) = lower(trim(r.tutor_group_name))
       order by id limit 1;
      if v_group is null then
        insert into public.tutor_groups (guild_id, season_id, name)
        values (p_guild_id, v_season, trim(r.tutor_group_name)) returning id into v_group;
      end if;
    end if;
    -- roster rows are always fuksis; a row someone already claimed (user_id set) is left alone
    insert into public.members (guild_id, season_id, email, display_name, role, tutor_group_id)
    values (p_guild_id, v_season, trim(r.email)::extensions.citext,
            coalesce(nullif(trim(r.display_name), ''), split_part(trim(r.email), '@', 1)), 'fuksi', v_group)
    on conflict (guild_id, season_id, email) do update
      set display_name = excluded.display_name,
          tutor_group_id = coalesce(excluded.tutor_group_id, public.members.tutor_group_id)
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

revoke all on function public.import_apply(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.import_apply(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
