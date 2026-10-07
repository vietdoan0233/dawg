-- 0004_import_export.sql: slice 5, import/export (SDD §5, §7 slice 5).
-- Captain-facing import with AI-assisted column mapping (preview + confirmation).
-- Captain-only export as member × category matrix + tier CSV.
-- Formula-injection-safe CSV escaping.

-- ---------- import_apply: atomic import with guild/season constraints ----------
-- Security-definer RPC: validates and applies imported data atomically.
-- All changes happen inside a single transaction; if any validation fails, nothing is inserted.
-- Captain-only, checked on entry.
create function public.import_apply(
  p_guild_id bigint,
  p_categories jsonb,    -- [{ name, color, icon }, ...]
  p_tasks jsonb,         -- [{ category_name, title, description, points_min, points_max, reviewer, max_repeats, required, requires_photo, requires_note, revealed_at, active }, ...]
  p_tiers jsonb,         -- [{ name, min_total }, ...]
  p_rules jsonb,         -- [{ category_name, tier_name (nullable), min_points }, ...]
  p_members jsonb,       -- [{ email, display_name, role, tutor_group_name }, ...]
  p_adjustments jsonb    -- [{ email, category_name, points, reason }, ...]
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_season_id bigint;
  v_member_id bigint;
  v_category_id bigint;
  v_tier_id bigint;
  v_tutor_group_id bigint;
  v_cat record;
  v_task record;
  v_tier record;
  v_rule record;
  v_member record;
  v_adj record;
  v_imported_categories int := 0;
  v_imported_tasks int := 0;
  v_imported_tiers int := 0;
  v_imported_rules int := 0;
  v_imported_members int := 0;
  v_imported_adjustments int := 0;
begin
  -- Privilege check: must be captain of this guild in the current season
  if not public.has_role(p_guild_id, array['captain']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock this guild to prevent concurrent imports
  perform pg_advisory_xact_lock(hashtextextended(p_guild_id::text, 0));

  -- Get current season
  select s.id into v_season_id from public.seasons s
   where s.guild_id = p_guild_id and s.is_current;
  if v_season_id is null then
    raise exception 'no_current_season' using errcode = '22023';
  end if;

  -- Import categories (colors lowercased per SDD v3.2 round 7)
  for v_cat in select * from jsonb_populate_recordset(null::record,
    p_categories) as x(name text, color text, icon text)
  loop
    insert into public.categories (guild_id, season_id, name, color, icon)
    values (p_guild_id, v_season_id, v_cat.name, lower(v_cat.color), v_cat.icon)
    on conflict (guild_id, season_id, name) do nothing;
    v_imported_categories := v_imported_categories + 1;
  end loop;

  -- Import tiers
  for v_tier in select * from jsonb_populate_recordset(null::record,
    p_tiers) as x(name text, min_total int)
  loop
    insert into public.tiers (guild_id, season_id, name, min_total)
    values (p_guild_id, v_season_id, v_tier.name, v_tier.min_total)
    on conflict (guild_id, season_id, name) do nothing;
    v_imported_tiers := v_imported_tiers + 1;
  end loop;

  -- Import tasks
  for v_task in select * from jsonb_populate_recordset(null::record,
    p_tasks) as x(category_name text, title text, description text,
                  points_min int, points_max int, reviewer text,
                  max_repeats int, required boolean, requires_photo boolean,
                  requires_note boolean, revealed_at timestamptz, active boolean)
  loop
    select id into v_category_id from public.categories
     where guild_id = p_guild_id and season_id = v_season_id
       and name = v_task.category_name;
    if v_category_id is null then
      raise exception 'category_not_found' using errcode = '22023';
    end if;

    insert into public.tasks
      (guild_id, season_id, category_id, title, description,
       points_min, points_max, reviewer, max_repeats, required,
       requires_photo, requires_note, revealed_at, active)
    values (p_guild_id, v_season_id, v_category_id, v_task.title,
            v_task.description, v_task.points_min, v_task.points_max,
            v_task.reviewer, v_task.max_repeats, v_task.required,
            v_task.requires_photo, v_task.requires_note,
            v_task.revealed_at, v_task.active)
    on conflict do nothing;
    v_imported_tasks := v_imported_tasks + 1;
  end loop;

  -- Import rules
  for v_rule in select * from jsonb_populate_recordset(null::record,
    p_rules) as x(category_name text, tier_name text, min_points int)
  loop
    select id into v_category_id from public.categories
     where guild_id = p_guild_id and season_id = v_season_id
       and name = v_rule.category_name;
    if v_category_id is null then
      raise exception 'category_not_found' using errcode = '22023';
    end if;

    v_tier_id := null;
    if v_rule.tier_name is not null then
      select id into v_tier_id from public.tiers
       where guild_id = p_guild_id and season_id = v_season_id
         and name = v_rule.tier_name;
      if v_tier_id is null then
        raise exception 'tier_not_found' using errcode = '22023';
      end if;
    end if;

    -- Skip 0-minimum categories per SDD
    if v_rule.min_points > 0 then
      insert into public.rules
        (guild_id, season_id, category_id, tier_id, min_points)
      values (p_guild_id, v_season_id, v_category_id, v_tier_id, v_rule.min_points)
      on conflict (guild_id, season_id, category_id, tier_id) do nothing;
      v_imported_rules := v_imported_rules + 1;
    end if;
  end loop;

  -- Import members and tutor groups
  for v_member in select * from jsonb_populate_recordset(null::record,
    p_members) as x(email text, display_name text, role text, tutor_group_name text)
  loop
    v_tutor_group_id := null;
    if v_member.tutor_group_name is not null then
      select id into v_tutor_group_id from public.tutor_groups
       where guild_id = p_guild_id and season_id = v_season_id
         and name = v_member.tutor_group_name;
      -- Create tutor group if it doesn't exist
      if v_tutor_group_id is null then
        insert into public.tutor_groups (guild_id, season_id, name)
        values (p_guild_id, v_season_id, v_member.tutor_group_name)
        on conflict do nothing
        returning id into v_tutor_group_id;
      end if;
    end if;

    insert into public.members
      (guild_id, season_id, email, display_name, role, tutor_group_id)
    values (p_guild_id, v_season_id, v_member.email::extensions.citext,
            v_member.display_name, v_member.role, v_tutor_group_id)
    on conflict (guild_id, season_id, email) do update
      set display_name = excluded.display_name,
          role = excluded.role,
          tutor_group_id = excluded.tutor_group_id
    where members.user_id is null;
    v_imported_members := v_imported_members + 1;
  end loop;

  -- Import adjustments (opening balances)
  for v_adj in select * from jsonb_populate_recordset(null::record,
    p_adjustments) as x(email text, category_name text, points int, reason text)
  loop
    select id into v_member_id from public.members
     where guild_id = p_guild_id and season_id = v_season_id
       and email = v_adj.email::extensions.citext;
    if v_member_id is null then
      raise exception 'member_not_found' using errcode = '22023';
    end if;

    select id into v_category_id from public.categories
     where guild_id = p_guild_id and season_id = v_season_id
       and name = v_adj.category_name;
    if v_category_id is null then
      raise exception 'category_not_found' using errcode = '22023';
    end if;

    insert into public.adjustments
      (guild_id, season_id, member_id, category_id, points, reason, created_by)
    values (p_guild_id, v_season_id, v_member_id, v_category_id,
            v_adj.points, v_adj.reason, public.my_member_id(p_guild_id));
    v_imported_adjustments := v_imported_adjustments + 1;
  end loop;

  return jsonb_build_object(
    'imported_categories', v_imported_categories,
    'imported_tasks', v_imported_tasks,
    'imported_tiers', v_imported_tiers,
    'imported_rules', v_imported_rules,
    'imported_members', v_imported_members,
    'imported_adjustments', v_imported_adjustments
  );
end $$;

-- Explicit grants: only authenticated users can call it (security definer checks captain role)
grant execute on function public.import_apply(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

-- ---------- Helpers for export ----------
-- Formula-injection escape: prefix =, +, -, @, tab, carriage return with apostrophe
create function public.csv_escape_formula(p_value text) returns text
language sql immutable strict set search_path = ''
as $$
  select case
    when p_value ~ '^[=+\-@\t\r]' then '''' || p_value
    else p_value
  end
$$;

grant execute on function public.csv_escape_formula(text) to authenticated;
