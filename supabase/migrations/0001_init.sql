-- 0001_init.sql: Fuksipisteet initial contract (SDD v3.1 §3-§5).
-- FROZEN after day 0 (AGENTS.md): changes come as new migrations, reviewed by lane A.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------- privileges first (ADR-1) ----------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- PUBLIC's implicit EXECUTE cannot be revoked per schema, so new functions of this role lose it everywhere.
alter default privileges revoke execute on functions from public;
-- explicit grants at the end of the file

-- ---------- tables ----------
create table guilds (
  id bigint generated always as identity primary key,
  name text not null, slug text not null unique,
  created_at timestamptz not null default now());

create table seasons (
  id bigint generated always as identity primary key,
  guild_id bigint not null references guilds on delete cascade,
  name text not null, starts_on date not null, ends_on date not null check (ends_on > starts_on),
  is_current boolean not null default false,
  unique (guild_id, id));
create unique index on seasons (guild_id) where is_current;

-- every season-scoped table: unique (guild_id, season_id, id) + FK (guild_id, season_id) -> seasons
-- v3.2: categories carry their own look (guilds differ in track count, colours, icons)
create table categories (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, name text not null,
  color text not null default '#888888' check (color ~ '^#[0-9a-f]{6}$'),
  icon text not null default 'hex' check (icon in ('cog','bell','goblet','tower','shield','hex','star','book','heart','flag')),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  unique (guild_id, season_id, name), unique (guild_id, season_id, id));
-- display order = id. ponytail: add categories.sort when a captain needs to reorder.

create table tutor_groups (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, name text not null,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  unique (guild_id, season_id, id));

create table members (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  user_id uuid references auth.users on delete cascade,      -- null = imported roster row not yet claimed
  email extensions.citext not null,
  display_name text not null,
  role text not null default 'fuksi' check (role in ('fuksi','tutor','organizer','captain')),
  tutor_group_id bigint,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, tutor_group_id) references tutor_groups (guild_id, season_id, id) on delete set null (tutor_group_id),
  unique (guild_id, season_id, email),
  unique (guild_id, season_id, user_id),
  unique (guild_id, season_id, id));
create index on members (user_id, guild_id, season_id);

create table member_codes (                                     -- no grants: only via RPCs
  member_id bigint primary key references members on delete cascade,
  code text not null unique default encode(extensions.gen_random_bytes(16), 'hex'));

-- tasks = map nodes
create table tasks (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, category_id bigint not null,
  title text not null, description text,
  points_min int not null check (points_min between 0 and 100),
  points_max int not null,                                     -- jäynä "1-∞p" = a captain-set ceiling
  check (points_max between points_min and 100),
  reviewer text not null default 'tutor' check (reviewer in ('tutor','captain')),
  check (points_max - points_min <= 2 or reviewer = 'captain'), -- wide ranges are captain-only
  max_repeats int not null default 1 check (max_repeats between 1 and 50),
  required boolean not null default false,
  requires_photo boolean not null default true,
  requires_note boolean not null default false,                -- write-in slots: note = event name
  revealed_at timestamptz not null default now(),              -- secret nodes: 'infinity' until captain reveals
  active boolean not null default true,                        -- retired, not secret
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  unique (guild_id, season_id, id),
  unique (guild_id, season_id, id, category_id));                -- lets submissions pin their category snapshot
-- display order = id (import preserves sheet/map order). ponytail: add tasks.sort when a captain needs to reorder.

create table tiers (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  name text not null, min_total int not null check (min_total > 0),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  unique (guild_id, season_id, name), unique (guild_id, season_id, min_total),
  unique (guild_id, season_id, id));

-- rules = category minimums; tier_id null = applies to every tier
create table rules (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  category_id bigint not null, tier_id bigint,
  min_points int not null check (min_points > 0),               -- import skips "[0]" categories
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  foreign key (guild_id, season_id, tier_id) references tiers (guild_id, season_id, id) on delete cascade,
  unique nulls not distinct (guild_id, season_id, category_id, tier_id));

-- events point at a node; no own points/category
create table events (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, task_id bigint not null,
  title text not null,
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, task_id) references tasks (guild_id, season_id, id),
  unique (guild_id, season_id, id));
-- One physical event, two nodes (Sitsit: Work 2p + Culture 1p) = two events (e.g. "Sitsit - workers").

-- submissions absorb check-ins (no checkins table)
create table submissions (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  task_id bigint not null, category_id bigint not null,          -- category snapshot: progress never joins tasks
  member_id bigint not null,
  event_id bigint,                                              -- set = earned by check-in
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  points_awarded int check (points_awarded >= 0),
  award_reason text check (length(award_reason) <= 300),        -- required when points_awarded > points_min
  photo_path text, photo_sha256 text,
  note text check (length(note) <= 500),
  reviewed_by bigint, reviewed_at timestamptz,                  -- check-in: scanner + scanned_at
  created_at timestamptz not null default now(),                -- check-in: synced_at
  foreign key (guild_id, season_id, task_id, category_id) references tasks (guild_id, season_id, id, category_id)
    on update cascade on delete cascade,                         -- recategorising a task moves its points too
  foreign key (guild_id, season_id, member_id)   references members    (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, event_id)    references events     (guild_id, season_id, id),  -- no action: deleting an event never erases approved points
  foreign key (guild_id, season_id, reviewed_by) references members    (guild_id, season_id, id) on delete set null (reviewed_by),
  check ((status = 'approved') = (points_awarded is not null)),
  check (event_id is null or status = 'approved'));
create unique index on submissions (event_id, member_id) where event_id is not null;
create index on submissions (guild_id, status, member_id);
create index on submissions (member_id) where status = 'approved';
create index on submissions (member_id, task_id);               -- roadmap, submit_task, award_task and task_visible all look up by (member, task)
create index on submissions (guild_id, photo_sha256);
create index on submissions (photo_path);

create table adjustments (                                      -- opening balances + captain corrections
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  member_id bigint not null, category_id bigint not null,
  points int not null, reason text not null,
  created_by bigint, created_at timestamptz not null default now(),
  foreign key (guild_id, season_id, member_id)   references members    (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  foreign key (guild_id, season_id, created_by)  references members    (guild_id, season_id, id) on delete set null (created_by));
create index on adjustments (member_id);

create table invites (
  code text primary key default encode(extensions.gen_random_bytes(9), 'hex'),
  guild_id bigint not null, season_id bigint not null,
  max_uses int not null default 300, used_count int not null default 0,
  expires_at timestamptz not null, revoked_at timestamptz, created_by bigint,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade);

create table ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null, calls int not null default 0,
  primary key (user_id, day));

-- ---------- RLS helpers (current season only; security definer; always called as (select fn(...))) ----------
create function public.current_season(p_guild_id bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select s.id from public.seasons s where s.guild_id = p_guild_id and s.is_current $$;

create function public.my_member_id(p_guild_id bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select m.id from public.members m
  where m.guild_id = p_guild_id and m.user_id = auth.uid()
    and m.season_id = public.current_season(p_guild_id)
$$;

create function public.is_member(p_guild_id bigint) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.my_member_id(p_guild_id) is not null $$;

create function public.has_role(p_guild_id bigint, p_roles text[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members m
                 where m.id = public.my_member_id(p_guild_id) and m.role = any (p_roles))
$$;

-- caller is a tutor whose group contains p_member_id
create function public.is_tutor_of(p_member_id bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.members me
    join public.members tgt
      on tgt.guild_id = me.guild_id and tgt.season_id = me.season_id
     and tgt.tutor_group_id = me.tutor_group_id
    where me.user_id = auth.uid() and me.role = 'tutor' and me.tutor_group_id is not null
      and me.season_id = public.current_season(me.guild_id)
      and tgt.id = p_member_id)
$$;

-- secret nodes: visible once revealed, to staff, or to a member who already owns a submission for it
create function public.task_visible(p_task_id bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and public.is_member(t.guild_id)
      and t.season_id = public.current_season(t.guild_id)
      and (t.revealed_at <= now()
           or public.has_role(t.guild_id, array['tutor','organizer','captain'])
           or exists (select 1 from public.submissions s
                      where s.task_id = t.id and s.member_id = public.my_member_id(t.guild_id))))
$$;

-- true when a required, active node still lacks an approved submission. Definer so a hidden
-- required node still counts against a tier even though RLS hides the task row from the caller.
-- Same access scope as submissions_select (self, captain, the member's tutor); anyone else gets
-- false, so it cannot be used to probe other members' progress.
create function public.required_missing(p_member_id bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.tasks t on t.guild_id = m.guild_id and t.season_id = m.season_id
    where m.id = p_member_id
      and (m.id = public.my_member_id(m.guild_id)
           or public.has_role(m.guild_id, array['captain'])
           or public.is_tutor_of(m.id))
      and t.required and t.active
      and not exists (select 1 from public.submissions s
                      where s.member_id = m.id and s.task_id = t.id and s.status = 'approved'))
$$;

-- ---------- views (security_invoker) ----------
-- progress never joins tasks: it uses the snapshotted category, so hidden nodes can't distort totals
create view progress with (security_invoker = true) as
select member_id, category_id, sum(points)::int as points
from (select member_id, category_id, points_awarded as points
        from public.submissions where status = 'approved'
      union all
      select member_id, category_id, points from public.adjustments) x
group by member_id, category_id;

-- highest tier whose total is reached, whose rules are met (cumulative: a tier also needs the rules of
-- every lower tier) and with no required node outstanding. A member with no tier gets no row.
create view member_tier with (security_invoker = true) as
select member_id, tier_id
from (
  select m.id as member_id,
    (select t.id
       from public.tiers t
      where t.guild_id = m.guild_id and t.season_id = m.season_id
        and (select coalesce(sum(p.points), 0) from public.progress p where p.member_id = m.id) >= t.min_total
        and not exists (
          select 1
          from public.rules r
          left join public.tiers rt on rt.id = r.tier_id
          where r.guild_id = m.guild_id and r.season_id = m.season_id
            and (r.tier_id is null or rt.min_total <= t.min_total)
            and (select coalesce(sum(p.points), 0) from public.progress p
                 where p.member_id = m.id and p.category_id = r.category_id) < r.min_points)
        and not public.required_missing(m.id)
      order by t.min_total desc
      limit 1) as tier_id
  from public.members m) x
where tier_id is not null;

-- ---------- award_task: the ONLY code that awards points ----------
-- Internal: never granted to public, anon or authenticated (callers are security definer RPCs). On Supabase
-- service_role keeps its default EXECUTE; that key is server-side only (supabase/functions/*), never in Next.js.
-- Returns 'ok' | 'duplicate' | 'limit_reached'; every other violation raises.
create function public.award_task(
  p_member_id bigint, p_task_id bigint, p_points int, p_reason text, p_source text,
  p_event_id bigint, p_reviewer_id bigint, p_submission_id bigint default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tasks;
  m public.members;
  n int;
begin
  if p_source not in ('submission', 'checkin') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if (p_source = 'submission') <> (p_submission_id is not null)
     or (p_source = 'checkin') <> (p_event_id is not null) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_member_id::text || ':' || p_task_id::text, 0));

  select * into t from public.tasks where id = p_task_id;
  select * into m from public.members where id = p_member_id;
  if t.id is null or m.id is null or t.guild_id <> m.guild_id or t.season_id <> m.season_id then
    raise exception 'task_member_mismatch' using errcode = '22023';
  end if;

  if p_points is null or p_points < t.points_min or p_points > t.points_max then
    raise exception 'points_out_of_range' using errcode = '22023';
  end if;
  if p_points > t.points_min and nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if p_source = 'submission' then
    select count(*) into n from public.submissions
     where member_id = p_member_id and task_id = p_task_id
       and status in ('pending', 'approved') and id <> p_submission_id;
    if n >= t.max_repeats then return 'limit_reached'; end if;

    update public.submissions
       set status = 'approved', points_awarded = p_points, award_reason = p_reason,
           reviewed_by = p_reviewer_id, reviewed_at = now()
     where id = p_submission_id and status = 'pending'
       and member_id = p_member_id and task_id = p_task_id;
    if not found then
      raise exception 'submission_mismatch' using errcode = '22023';
    end if;
    return 'ok';
  end if;

  -- check-in: the event must point at this node; duplicate is checked before the limit
  if not exists (select 1 from public.events e
                  where e.id = p_event_id and e.task_id = p_task_id
                    and e.guild_id = t.guild_id and e.season_id = t.season_id) then
    raise exception 'event_task_mismatch' using errcode = '22023';
  end if;
  if exists (select 1 from public.submissions where event_id = p_event_id and member_id = p_member_id) then
    return 'duplicate';
  end if;
  select count(*) into n from public.submissions
   where member_id = p_member_id and task_id = p_task_id and status in ('pending', 'approved');
  if n >= t.max_repeats then return 'limit_reached'; end if;

  insert into public.submissions
    (guild_id, season_id, task_id, category_id, member_id, event_id, status,
     points_awarded, award_reason, reviewed_by, reviewed_at)
  values
    (t.guild_id, t.season_id, t.id, t.category_id, p_member_id, p_event_id, 'approved',
     p_points, p_reason, p_reviewer_id, now())
  on conflict (event_id, member_id) where event_id is not null do nothing;
  if not found then return 'duplicate'; end if;
  return 'ok';
end $$;

-- ---------- RPCs (slice 1) ----------
-- Self-submission only. p_with_member_ids stays in the signature (SDD §4 contract) but a non-empty
-- array is rejected until group submission is designed (consent, submitted_by, skip-at-limit).
create function public.submit_task(
  p_task_id bigint, p_note text default null, p_photo_path text default null,
  p_photo_sha256 text default null, p_with_member_ids bigint[] default '{}')
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tasks;
  me bigint;
  v_prefix text;
  v_new bigint;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if cardinality(coalesce(p_with_member_ids, '{}')) > 0 then
    raise exception 'group_submit_unsupported' using errcode = '0A000';
  end if;

  -- missing, foreign-guild, hidden and retired nodes all look the same
  select * into t from public.tasks where id = p_task_id;
  if t.id is null or not t.active or not public.task_visible(p_task_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  me := public.my_member_id(t.guild_id);
  if not public.has_role(t.guild_id, array['fuksi']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if t.requires_note and nullif(btrim(p_note), '') is null then
    raise exception 'note_required' using errcode = '22023';
  end if;
  if t.requires_photo and p_photo_path is null then
    raise exception 'photo_required' using errcode = '22023';
  end if;
  if (p_photo_path is null) <> (p_photo_sha256 is null) then
    raise exception 'invalid_photo' using errcode = '22023';
  end if;
  if p_photo_path is not null then
    v_prefix := t.guild_id::text || '/' || me::text || '/';
    if left(p_photo_path, length(v_prefix)) <> v_prefix or position('..' in p_photo_path) > 0
       or length(p_photo_path) > 200 or p_photo_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid_photo' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(me::text || ':' || t.id::text, 0));
  if (select count(*) from public.submissions s
       where s.member_id = me and s.task_id = t.id and s.status in ('pending', 'approved')) >= t.max_repeats then
    raise exception 'limit_reached' using errcode = '23P01';
  end if;
  insert into public.submissions
    (guild_id, season_id, task_id, category_id, member_id, note, photo_path, photo_sha256)
  values
    (t.guild_id, t.season_id, t.id, t.category_id, me, p_note, p_photo_path, p_photo_sha256)
  returning id into v_new;
  return v_new;
end $$;

-- Pending rows only. Approve defaults to points_min. One row's limit_reached does not block the rest, but a
-- row that is missing, not reviewable by the caller, or no longer pending raises and rolls back the whole batch.
create function public.review_submissions(
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
      raise exception 'not_pending' using errcode = '22023';
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
      if not found then raise exception 'not_pending' using errcode = '22023'; end if;
      submission_id := s.id; result := 'rejected';
      return next;
    end if;
  end loop;
end $$;

-- The guild's map for the caller: visible nodes with own status, hidden nodes as locked placeholders.
create function public.roadmap(p_guild_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me bigint := public.my_member_id(p_guild_id);
  s bigint := public.current_season(p_guild_id);
begin
  if me is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'member_id', me,
    'total', (select coalesce(sum(points), 0) from public.progress where member_id = me),
    'own_tier_id', (select tier_id from public.member_tier where member_id = me),
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'min_total', t.min_total)
                                        order by t.min_total), '[]')
                from public.tiers t where t.guild_id = p_guild_id and t.season_id = s),
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

-- Tutor-group totals only (fuksis' points); no individual names or scores.
create function public.leaderboard(p_guild_id bigint)
returns table (group_id bigint, group_name text, total_points bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_member(p_guild_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select g.id, g.name, coalesce(sum(p.points), 0)::bigint
      from public.tutor_groups g
      left join public.members m on m.tutor_group_id = g.id and m.role = 'fuksi'
      left join public.progress p on p.member_id = m.id
     where g.guild_id = p_guild_id and g.season_id = public.current_season(p_guild_id)
     group by g.id, g.name
     order by 3 desc, g.name;
end $$;

-- ---------- RLS on for EVERY table; clients get SELECT policies only ----------
alter table guilds       enable row level security;
alter table seasons      enable row level security;
alter table categories   enable row level security;
alter table tutor_groups enable row level security;
alter table members      enable row level security;
alter table member_codes enable row level security;   -- no policy, no grant
alter table tasks        enable row level security;
alter table tiers        enable row level security;
alter table rules        enable row level security;
alter table events       enable row level security;
alter table submissions  enable row level security;
alter table adjustments  enable row level security;
alter table invites      enable row level security;   -- no policy, no grant
alter table ai_usage     enable row level security;   -- no policy, no grant

create policy guilds_select on guilds for select to authenticated
  using ((select public.is_member(id)));
create policy seasons_select on seasons for select to authenticated
  using ((select public.is_member(guild_id)));

create policy categories_select on categories for select to authenticated
  using ((select public.is_member(guild_id)) and season_id = (select public.current_season(guild_id)));
create policy tutor_groups_select on tutor_groups for select to authenticated
  using ((select public.is_member(guild_id)) and season_id = (select public.current_season(guild_id)));
create policy tiers_select on tiers for select to authenticated
  using ((select public.is_member(guild_id)) and season_id = (select public.current_season(guild_id)));
create policy rules_select on rules for select to authenticated
  using ((select public.is_member(guild_id)) and season_id = (select public.current_season(guild_id)));
create policy members_select on members for select to authenticated
  using ((select public.is_member(guild_id)) and season_id = (select public.current_season(guild_id)));

-- secret nodes: tasks and events go through task_visible()
create policy tasks_select on tasks for select to authenticated
  using ((select public.is_member(guild_id)) and season_id = (select public.current_season(guild_id))
         and (select public.task_visible(id)));
create policy events_select on events for select to authenticated
  using ((select public.is_member(guild_id)) and season_id = (select public.current_season(guild_id))
         and (select public.task_visible(task_id)));

-- own rows; a tutor also sees their group; a captain sees the whole guild (current season)
create policy submissions_select on submissions for select to authenticated
  using (season_id = (select public.current_season(guild_id))
         and (member_id = (select public.my_member_id(guild_id))
              or (select public.has_role(guild_id, array['captain']))
              or (select public.is_tutor_of(member_id))));
create policy adjustments_select on adjustments for select to authenticated
  using (season_id = (select public.current_season(guild_id))
         and (member_id = (select public.my_member_id(guild_id))
              or (select public.has_role(guild_id, array['captain']))
              or (select public.is_tutor_of(member_id))));

-- ---------- explicit grants (everything else stays revoked) ----------
-- re-assert the table lockdown in case this file runs under a role whose default privileges differ
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on guilds, seasons, categories, tutor_groups, tasks, tiers, rules, events,
                submissions, adjustments to authenticated;
grant select (id, guild_id, season_id, display_name, role, tutor_group_id) on members to authenticated;  -- no email, no user_id
grant select on progress, member_tier to authenticated;
-- invites, member_codes, ai_usage: no grant.

-- re-assert function privileges, then grant each client-callable function individually.
-- award_task is NOT granted: internal only.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.current_season(bigint), public.my_member_id(bigint), public.is_member(bigint),
  public.has_role(bigint, text[]), public.is_tutor_of(bigint), public.task_visible(bigint),
  public.required_missing(bigint)
  to authenticated;
grant execute on function
  public.submit_task(bigint, text, text, text, bigint[]),
  public.review_submissions(bigint[], boolean, int, text),
  public.roadmap(bigint),
  public.leaderboard(bigint)
  to authenticated;
