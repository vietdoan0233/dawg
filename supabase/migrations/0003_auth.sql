-- 0003_auth.sql: slice 2, real login (SDD §1, §2 Auth, §4 "unchanged" RPCs, §10 bootstrap_guild).
-- Email 6-digit OTP; only @aalto.fi may create an account; invites only ever make fuksis; roles change only
-- through the captain's set_role.

-- ---------- auth hook: Before User Created ----------
-- Runs inside Supabase Auth (supabase_auth_admin) before any account is created, whatever the sign-in method.
-- Seeded demo users are inserted by SQL and never pass through it.
-- ponytail: one hardcoded domain; make it a per-guild column when a guild outside Aalto joins.
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  if lower(coalesce(event -> 'user' ->> 'email', '')) !~ '^[^@\s]+@aalto\.fi$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Use your @aalto.fi email address.'));
  end if;
  return '{}'::jsonb;
end $$;

-- ---------- auth hook: Custom Access Token ----------
-- Runs every time Auth issues a token. Password login is refused for real accounts: otherwise anyone could
-- password-sign-up captain@aalto.fi before the captain's first OTP, and that password keeps working after the
-- captain confirms the email (pre-account hijack, reproduced against local Auth). Only the seeded
-- @demo.invalid users may use a password; nobody can create such an account (the hook above allows @aalto.fi).
create function public.hook_custom_access_token(event jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  if event ->> 'authentication_method' = 'password'
     and lower(coalesce(event -> 'claims' ->> 'email', '')) !~ '@demo\.invalid$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Log in with the 6-digit code sent to your email.'));
  end if;
  return jsonb_build_object('claims', event -> 'claims');
end $$;

-- ---------- join ----------
-- Invite -> verified email -> member. Claims the imported/bootstrapped roster row with the same email (keeping its
-- role, e.g. the bootstrap captain), else creates a fuksi. The invite itself never carries a role.
create function public.join_guild(p_code text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invites;
  v_email text;
  v_member bigint;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));   -- one join at a time per account
  -- Only a verified @aalto.fi account may join: email_confirmed_at = the user proved they own the email; the
  -- domain is re-checked because the creation hook does not run on a later email change.
  select u.email into v_email from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) ~ '^[^@\s]+@aalto\.fi$';
  if v_email is null then raise exception 'email_unverified' using errcode = '42501'; end if;

  select * into inv from public.invites where code = p_code for update;   -- serialises used_count
  -- already in: opening the link again (even an expired or revoked one) is harmless and uses nothing
  if inv.code is not null and public.my_member_id(inv.guild_id) is not null then return inv.guild_id; end if;
  if inv.code is null or inv.revoked_at is not null or inv.expires_at <= now()
     or inv.season_id is distinct from public.current_season(inv.guild_id) then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;

  -- pre-listed roster row (import / bootstrap captain): its owner gets in even if someone else burned the
  -- invite's uses, and claiming it does not use one up
  update public.members set user_id = auth.uid()
   where guild_id = inv.guild_id and season_id = inv.season_id and email = v_email::extensions.citext and user_id is null
  returning id into v_member;
  if v_member is null then
    if inv.used_count >= inv.max_uses
       or exists (select 1 from public.members m        -- that email's row belongs to another account
                   where m.guild_id = inv.guild_id and m.season_id = inv.season_id and m.email = v_email::extensions.citext) then
      raise exception 'invalid_invite' using errcode = '22023';
    end if;
    insert into public.members (guild_id, season_id, user_id, email, display_name)
    values (inv.guild_id, inv.season_id, auth.uid(), v_email,
            initcap(replace(split_part(v_email, '@', 1), '.', ' ')))      -- "aino.virtanen" -> "Aino Virtanen"
    returning id into v_member;
    update public.invites set used_count = used_count + 1 where code = inv.code;
  end if;
  insert into public.member_codes (member_id) values (v_member) on conflict do nothing;
  return inv.guild_id;
end $$;

-- ---------- own QR code ----------
-- A lost or leaked QR: the member makes a new one; the old code stops working at once.
create function public.rotate_my_code(p_guild_id bigint) returns text
language sql security definer set search_path = ''
as $$
  update public.member_codes set code = encode(extensions.gen_random_bytes(16), 'hex')
   where member_id = public.my_member_id(p_guild_id)
  returning code
$$;

-- ---------- captain: invites ----------
create function public.create_invite(p_guild_id bigint, p_max_uses int default 300, p_days int default 30)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_code text;
begin
  if not public.has_role(p_guild_id, array['captain']) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_max_uses not between 1 and 1000 or p_days not between 1 and 365 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  insert into public.invites (guild_id, season_id, max_uses, expires_at, created_by)
  values (p_guild_id, public.current_season(p_guild_id), p_max_uses, now() + make_interval(days => p_days),
          public.my_member_id(p_guild_id))
  returning code into v_code;
  return v_code;
end $$;

create function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_guild bigint;
begin
  select guild_id into v_guild from public.invites where code = p_code;
  if v_guild is null or not public.has_role(v_guild, array['captain']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.invites set revoked_at = now() where code = p_code and revoked_at is null;
end $$;

create function public.list_invites(p_guild_id bigint)
returns table (code text, max_uses int, used_count int, expires_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_role(p_guild_id, array['captain']) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select i.code, i.max_uses, i.used_count, i.expires_at, i.revoked_at
      from public.invites i
     where i.guild_id = p_guild_id and i.season_id = public.current_season(p_guild_id)
     order by i.expires_at desc;
end $$;

-- ---------- captain: roles ----------
-- The only way to change a role or tutor group. A captain cannot change their own row, so a guild can never
-- lose its last captain by accident.
create function public.set_role(p_member_id bigint, p_role text, p_tutor_group_id bigint default null)
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
  -- role CHECK and the composite tutor-group FK reject a bad role or another guild's group
  update public.members set role = p_role, tutor_group_id = p_tutor_group_id where id = m.id;
end $$;

-- ---------- platform admin: onboard a guild (SDD §10) ----------
-- Service role only (Supabase SQL editor / server). Guild + current season + unclaimed captain roster row +
-- an ordinary one-use invite. Whoever verifies captain_email via OTP becomes captain; anyone else gets fuksi.
create function public.bootstrap_guild(p_name text, p_slug text, p_captain_email text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  g bigint; s bigint; v_code text; y int;
  v_email text := lower(btrim(p_captain_email));
begin
  if v_email !~ '^[^@\s]+@aalto\.fi$' then raise exception 'invalid_email' using errcode = '22023'; end if;
  insert into public.guilds (name, slug) values (p_name, p_slug) returning id into g;
  -- the academic year we are in (Aug-Dec = this year's, Jan-Jul = last year's), running until May 31st
  y := extract(year from current_date)::int - (extract(month from current_date) < 8)::int;
  insert into public.seasons (guild_id, name, starts_on, ends_on, is_current)
  values (g, y || '-' || right((y + 1)::text, 2), current_date, make_date(y + 1, 5, 31), true)
  returning id into s;
  insert into public.members (guild_id, season_id, email, display_name, role)
  values (g, s, v_email, initcap(replace(split_part(v_email, '@', 1), '.', ' ')), 'captain');
  insert into public.invites (guild_id, season_id, max_uses, expires_at)
  values (g, s, 1, now() + interval '7 days') returning code into v_code;
  return v_code;
end $$;

-- ---------- grants ----------
revoke all on function public.hook_before_user_created(jsonb), public.hook_custom_access_token(jsonb), public.join_guild(text), public.rotate_my_code(bigint),
  public.create_invite(bigint, int, int), public.revoke_invite(text), public.list_invites(bigint),
  public.set_role(bigint, text, bigint), public.bootstrap_guild(text, text, text)
  from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;   -- required by Supabase for Postgres hooks
grant execute on function public.hook_before_user_created(jsonb), public.hook_custom_access_token(jsonb) to supabase_auth_admin;
grant execute on function
  public.join_guild(text), public.rotate_my_code(bigint),
  public.create_invite(bigint, int, int), public.revoke_invite(text), public.list_invites(bigint),
  public.set_role(bigint, text, bigint)
  to authenticated;
-- bootstrap_guild: no client grant (service_role keeps its default EXECUTE).
