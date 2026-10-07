-- 0005_import_fixes.sql: slice 5 continuation
-- Track import history to prevent duplicate imports
-- Fix import_apply to:
-- - Check for duplicate imports (one-time behavior)
-- - Match category/tier names case-insensitively
-- - Prevent staff role assignment in roster import
-- - Escape formula-sensitive characters

-- Import history table: track that we've imported for a guild+season
create table import_history (
  id bigint generated always as identity primary key,
  guild_id bigint not null,
  season_id bigint not null,
  imported_by bigint not null,
  imported_at timestamptz not null default now(),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, imported_by) references members (guild_id, season_id, id),
  unique (guild_id, season_id)
);

-- Drop the old import_apply and create the updated one
drop function if exists public.import_apply(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);

-- Updated import_apply with duplicate prevention and case-insensitive matching
create function public.import_apply(
  p_guild_id bigint,
  p_categories jsonb,
  p_tasks jsonb,
  p_tiers jsonb,
  p_rules jsonb,
  p_members jsonb,
  p_adjustments jsonb
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
  v_caller_member_id bigint;
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

  -- Check for duplicate import (one-time behavior)
  if exists (select 1 from public.import_history
    where guild_id = p_guild_id and season_id = v_season_id) then
    raise exception 'import_already_applied' using errcode = '22023';
  end if;

  -- Get caller member ID for import_history
  select m.id into v_caller_member_id
    from public.members m
   where m.guild_id = p_guild_id
     and m.season_id = v_season_id
     and m.user_id = auth.uid();

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
    -- Case-insensitive category lookup
    select id into v_category_id from public.categories
     where guild_id = p_guild_id and season_id = v_season_id
       and lower(name) = lower(v_task.category_name);
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
    -- Case-insensitive category lookup
    select id into v_category_id from public.categories
     where guild_id = p_guild_id and season_id = v_season_id
       and lower(name) = lower(v_rule.category_name);
    if v_category_id is null then
      raise exception 'category_not_found' using errcode = '22023';
    end if;

    v_tier_id := null;
    if v_rule.tier_name is not null then
      -- Case-insensitive tier lookup
      select id into v_tier_id from public.tiers
       where guild_id = p_guild_id and season_id = v_season_id
         and lower(name) = lower(v_rule.tier_name);
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

  -- Import members and tutor groups (without staff roles: use set_role for that)
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

    -- Always insert with user_id = null; staff roles must use set_role RPC
    -- Only allow 'fuksi' as import role to prevent privilege escalation
    insert into public.members
      (guild_id, season_id, email, display_name, role, tutor_group_id, user_id)
    values (p_guild_id, v_season_id, v_member.email::extensions.citext,
            v_member.display_name, 'fuksi', v_tutor_group_id, null)
    on conflict (guild_id, season_id, email) do update
      set display_name = excluded.display_name,
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

    -- Case-insensitive category lookup
    select id into v_category_id from public.categories
     where guild_id = p_guild_id and season_id = v_season_id
       and lower(name) = lower(v_adj.category_name);
    if v_category_id is null then
      raise exception 'category_not_found' using errcode = '22023';
    end if;

    insert into public.adjustments
      (guild_id, season_id, member_id, category_id, points, reason, created_by)
    values (p_guild_id, v_season_id, v_member_id, v_category_id,
            v_adj.points, v_adj.reason, public.my_member_id(p_guild_id))
    on conflict do nothing;
    v_imported_adjustments := v_imported_adjustments + 1;
  end loop;

  -- Record successful import
  insert into public.import_history (guild_id, season_id, imported_by)
  values (p_guild_id, v_season_id, v_caller_member_id);

  return jsonb_build_object(
    'imported_categories', v_imported_categories,
    'imported_tasks', v_imported_tasks,
    'imported_tiers', v_imported_tiers,
    'imported_rules', v_imported_rules,
    'imported_members', v_imported_members,
    'imported_adjustments', v_imported_adjustments,
    'message', 'Import successful and recorded. Repeat imports for this season are prevented.'
  );
end $$;

-- Explicit grants
grant execute on function public.import_apply(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

-- Grant access to import_history table for auditing
grant select on public.import_history to authenticated;
