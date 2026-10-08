-- DEMO PROJECTS ONLY. NOT a migration: never run this on a pilot/real database.
-- Per-visitor demo rooms: every visitor of the public demo gets their own copy of the demo guild, so people who
-- scan the same QR code never see (or break) each other's clicks. The copy has its own 7 demo users
-- (demo.s<n>.<role>@demo.invalid, password 'demo-password', like seed.sql), the same tasks/tiers/rules, fresh
-- events and a copy of the crowd from demo-crowd.sql. Demo Fuksi 3 stays empty.
-- The rooms are separate for convenience, not secrecy: anyone who guesses a room number can log in to it, the same
-- as the shared demo users today.
-- Run after `npx supabase db reset` (+ `npm run demo:crowd`):  npm run demo:sandbox   (safe to run again)
-- The function refuses to run unless guild 1 is the seeded demo guild with its demo users.
-- ponytail: rooms are never deleted; the 2000 cap bounds the growth (~1.6k rows each). Run `db reset` to clear them.

create table if not exists public.demo_sandboxes (
  n serial primary key,
  guild_id bigint references public.guilds on delete cascade,
  created_at timestamptz not null default now());
alter table public.demo_sandboxes enable row level security;     -- no policy, no grant: only the function below
revoke all on public.demo_sandboxes from public, anon, authenticated;
revoke all on sequence public.demo_sandboxes_n_seq from public, anon, authenticated;
create index if not exists demo_sandboxes_created_at on public.demo_sandboxes (created_at);

create or replace function public.create_demo_sandbox() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  tg bigint := 1;                                               -- template: the seeded demo guild
  ts bigint := public.current_season(1);
  demo_emails text[] := array['demo.captain@demo.invalid', 'demo.tutor.a@demo.invalid', 'demo.tutor.b@demo.invalid',
                              'demo.fuksi.1@demo.invalid', 'demo.fuksi.2@demo.invalid', 'demo.fuksi.3@demo.invalid',
                              'demo.organizer@demo.invalid'];
  v_n int; g bigint; s bigint; v_tag text; v_hash text; v_id bigint;
  tmap jsonb := '{}';                                           -- template task id  -> new task id
  emap jsonb := '{}';                                           -- template event id -> new event id
  r record;
begin
  if ts is null or (select count(*) from public.members m
                     where m.guild_id = tg and m.season_id = ts and m.user_id is not null
                       and m.email::text = any (demo_emails)) <> 7 then
    raise exception 'demo_sandbox_unavailable: this is not a demo database' using errcode = '42501';
  end if;

  -- one creator at a time, so the limits below cannot be raced
  perform pg_advisory_xact_lock(hashtextextended('create_demo_sandbox', 0));
  if (select count(*) from public.demo_sandboxes where created_at > now() - interval '60 seconds') >= 40 then
    raise exception 'demo_sandbox_busy: too many new demo rooms right now, please try again in a minute'
      using errcode = '54000';
  end if;
  if (select count(*) from public.demo_sandboxes) >= 2000 then
    raise exception 'demo_sandbox_full: the demo has no free rooms left' using errcode = '54000';
  end if;

  insert into public.demo_sandboxes default values returning n into v_n;
  v_tag := 's' || v_n;
  insert into public.guilds (name, slug) values ('Data Guild', 'demo-' || v_n) returning id into g;
  update public.demo_sandboxes set guild_id = g where n = v_n;
  insert into public.seasons (guild_id, name, starts_on, ends_on, is_current)
  select g, x.name, x.starts_on, x.ends_on, true from public.seasons x where x.id = ts
  returning id into s;

  -- categories and tiers have unique names, so they map by name
  insert into public.categories (guild_id, season_id, name, color, icon)
  select g, s, c.name, c.color, c.icon from public.categories c where c.guild_id = tg and c.season_id = ts order by c.id;
  insert into public.tiers (guild_id, season_id, name, min_total)
  select g, s, t.name, t.min_total from public.tiers t where t.guild_id = tg and t.season_id = ts order by t.id;
  insert into public.rules (guild_id, season_id, category_id, tier_id, min_points)
  select g, s, nc.id, nt.id, ru.min_points
    from public.rules ru
    join public.categories oc on oc.id = ru.category_id
    join public.categories nc on nc.guild_id = g and nc.season_id = s and nc.name = oc.name
    left join public.tiers ot on ot.id = ru.tier_id
    left join public.tiers nt on nt.guild_id = g and nt.season_id = s and nt.name = ot.name
   where ru.guild_id = tg and ru.season_id = ts;

  -- tasks have no unique key, so map them one by one (display order = id, kept)
  for r in select t.*, oc.name as cat from public.tasks t join public.categories oc on oc.id = t.category_id
            where t.guild_id = tg and t.season_id = ts order by t.id loop
    insert into public.tasks (guild_id, season_id, category_id, title, description, points_min, points_max, reviewer,
                              max_repeats, required, requires_photo, requires_note, revealed_at, active)
    select g, s, nc.id, r.title, r.description, r.points_min, r.points_max, r.reviewer,
           r.max_repeats, r.required, r.requires_photo, r.requires_note, r.revealed_at, r.active
      from public.categories nc where nc.guild_id = g and nc.season_id = s and nc.name = r.cat
    returning id into v_id;
    tmap := tmap || jsonb_build_object(r.id::text, v_id);
  end loop;

  -- events get a fresh window, like seed.sql
  for r in select e.* from public.events e where e.guild_id = tg and e.season_id = ts order by e.id loop
    insert into public.events (guild_id, season_id, task_id, title, starts_at, ends_at)
    values (g, s, (tmap ->> r.task_id::text)::bigint, r.title, now() - interval '1 hour', now() + interval '60 days')
    returning id into v_id;
    emap := emap || jsonb_build_object(r.id::text, v_id);
  end loop;

  -- 7 demo users of this room; one bcrypt hash for all (same password), keeps the call fast
  v_hash := extensions.crypt('demo-password', extensions.gen_salt('bf'));
  with u as (
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
           regexp_replace(e, '^demo\.', 'demo.' || v_tag || '.'), v_hash, now(),
           '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
      from unnest(demo_emails) e
    returning id, email),
  i as (
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    select u.id, u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
           'email', now(), now(), now()
      from u)
  insert into public.members (guild_id, season_id, user_id, email, display_name, role)
  select g, s, u.id, u.email, om.display_name, om.role
    from u join public.members om
      on om.guild_id = tg and om.season_id = ts and regexp_replace(om.email::text, '^demo\.', 'demo.' || v_tag || '.') = u.email;
  insert into public.member_codes (member_id) select m.id from public.members m where m.guild_id = g and m.user_id is not null;

  -- the crowd (roster rows, cannot log in): crowd.01@… -> crowd.s<n>.01@…
  insert into public.members (guild_id, season_id, email, display_name, role)
  select g, s, regexp_replace(om.email::text, '^crowd\.', 'crowd.' || v_tag || '.'), om.display_name, om.role
    from public.members om where om.guild_id = tg and om.season_id = ts and om.email::text like 'crowd.%' order by om.id;

  -- history of the crowd and Demo Fuksi 1/2 (not 3). Members map by email; a reviewer/creator outside the copy
  -- becomes null. Photos are not copied.
  insert into public.submissions (guild_id, season_id, task_id, category_id, member_id, event_id, status, points_awarded,
                                  award_reason, note, reviewed_by, reviewed_at, created_at)
  select g, s, nt.id, nt.category_id, nm.id, (emap ->> x.event_id::text)::bigint, x.status, x.points_awarded,
         x.award_reason, x.note, nr.id, x.reviewed_at, x.created_at
    from public.submissions x
    join public.tasks nt on nt.id = (tmap ->> x.task_id::text)::bigint
    join public.members om on om.id = x.member_id
    join public.members nm on nm.guild_id = g and nm.season_id = s
     and nm.email::text = regexp_replace(om.email::text, '^(demo|crowd)\.', '\1.' || v_tag || '.')
    left join public.members orv on orv.id = x.reviewed_by
    left join public.members nr on nr.guild_id = g and nr.season_id = s
     and nr.email::text = regexp_replace(orv.email::text, '^(demo|crowd)\.', '\1.' || v_tag || '.')
   where x.guild_id = tg and x.season_id = ts
     and (om.email::text like 'crowd.%' or om.email::text in ('demo.fuksi.1@demo.invalid', 'demo.fuksi.2@demo.invalid'))
   order by x.id;

  insert into public.adjustments (guild_id, season_id, member_id, category_id, points, reason, created_by, created_at)
  select g, s, nm.id, nc.id, a.points, a.reason, nb.id, a.created_at
    from public.adjustments a
    join public.categories oc on oc.id = a.category_id
    join public.categories nc on nc.guild_id = g and nc.season_id = s and nc.name = oc.name
    join public.members om on om.id = a.member_id
    join public.members nm on nm.guild_id = g and nm.season_id = s
     and nm.email::text = regexp_replace(om.email::text, '^(demo|crowd)\.', '\1.' || v_tag || '.')
    left join public.members ob on ob.id = a.created_by
    left join public.members nb on nb.guild_id = g and nb.season_id = s
     and nb.email::text = regexp_replace(ob.email::text, '^(demo|crowd)\.', '\1.' || v_tag || '.')
   where a.guild_id = tg and a.season_id = ts
     and (om.email::text like 'crowd.%' or om.email::text in ('demo.fuksi.1@demo.invalid', 'demo.fuksi.2@demo.invalid'))
   order by a.id;

  return v_n;
end $$;

revoke all on function public.create_demo_sandbox() from public;
grant execute on function public.create_demo_sandbox() to anon, authenticated;

notify pgrst, 'reload schema';                                  -- let the API see the new function now
