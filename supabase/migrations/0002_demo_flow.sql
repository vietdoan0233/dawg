-- 0002_demo_flow.sql: the RPCs and storage the 3-minute demo needs (SDD §4, §7 slices 3-5).
-- checkin + my_code (slice 3), proofs bucket (slice 4), update_task reveal (slice 5).

-- ---------- slice 3: check-in ----------
-- The fuksi's own QR payload. Codes are never readable from tables (member_codes has no grant).
create function public.my_code(p_guild_id bigint) returns text
language sql stable security definer set search_path = ''
as $$
  select c.code from public.member_codes c where c.member_id = public.my_member_id(p_guild_id)
$$;

-- Organizer/tutor/captain scans a fuksi's code at an event. scanned_at is when the phone scanned it
-- (offline queue replays later): it must fall in the event window +-2 h and be at most 24 h old.
-- Returns ok | duplicate | limit_reached | unknown | outside_window. Hidden nodes still award (ignores revealed_at).
create function public.checkin(p_event_id bigint, p_member_code text, p_scanned_at timestamptz)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  e public.events;
  v_member bigint;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into e from public.events where id = p_event_id;
  -- a retired node (active = false) awards nothing, same as submit_task
  if e.id is null or e.season_id <> public.current_season(e.guild_id)
     or not exists (select 1 from public.tasks t where t.id = e.task_id and t.active)
     or not public.has_role(e.guild_id, array['organizer','tutor','captain']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- the code must belong to a fuksi of the same guild and season; anything else looks the same
  select m.id into v_member
    from public.member_codes c join public.members m on m.id = c.member_id
   where c.code = p_member_code and m.guild_id = e.guild_id and m.season_id = e.season_id and m.role = 'fuksi';
  if v_member is null then return 'unknown'; end if;

  if p_scanned_at is null or p_scanned_at > now() + interval '5 minutes' or p_scanned_at < now() - interval '24 hours'
     or p_scanned_at < e.starts_at - interval '2 hours' or p_scanned_at > e.ends_at + interval '2 hours' then
    return 'outside_window';
  end if;

  return public.award_task(v_member, e.task_id, (select t.points_min from public.tasks t where t.id = e.task_id),
                           null, 'checkin', e.id, public.my_member_id(e.guild_id));
end $$;

-- ---------- slice 5: reveal ----------
-- Captain edits a node. Prototype scope: reveal only (revealed_at = now()). ponytail: the other
-- update_task fields (points, repeats, scheduled reveal) come with the captain edit screen.
create function public.update_task(p_task_id bigint, p_reveal boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.tasks;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  select * into t from public.tasks where id = p_task_id;
  if t.id is null or not t.active or t.season_id <> public.current_season(t.guild_id)
     or not public.has_role(t.guild_id, array['captain']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reveal and t.revealed_at > now() then
    update public.tasks set revealed_at = now() where id = t.id;
  end if;
end $$;

-- ---------- slice 4: photo proofs ----------
-- Path = <guild_id>/<member_id>/<file>, the same prefix submit_task enforces. Private bucket; the only
-- client write in the app (AGENTS.md exception): a fuksi uploads into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- {guild_id, member_id} from the path, or null when it is not exactly <id>/<id>/<file> (no leading zeros, so it
-- matches the string prefix submit_task builds)
-- ponytail: no per-folder quota; the slice-4 purge job also removes files no submission references
create function public.proof_owner(p_name text) returns bigint[]
language sql immutable set search_path = ''
as $$
  select case when p_name ~ '^[1-9][0-9]{0,17}/[1-9][0-9]{0,17}/[^/]+$'
              then array[split_part(p_name, '/', 1)::bigint, split_part(p_name, '/', 2)::bigint] end
$$;

create policy proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs'
              and (public.proof_owner(name))[2] = public.my_member_id((public.proof_owner(name))[1]));

-- same audience as submissions_select: owner, the member's tutor, captain
create policy proofs_select on storage.objects for select to authenticated
  using (bucket_id = 'proofs'
         and ((public.proof_owner(name))[2] = public.my_member_id((public.proof_owner(name))[1])
              or public.has_role((public.proof_owner(name))[1], array['captain'])
              or public.is_tutor_of((public.proof_owner(name))[2])));

-- 0001's submit_task plus one check: a photo path must point at an uploaded proof (0001 is frozen).
create or replace function public.submit_task(
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
    -- the file must really be uploaded (and by the caller: proofs_insert only allows their own folder), and unused
    if not exists (select 1 from storage.objects o where o.bucket_id = 'proofs' and o.name = p_photo_path)
       or exists (select 1 from public.submissions s where s.photo_path = p_photo_path) then  -- one photo, one submission
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

-- ---------- grants ----------
revoke all on function public.my_code(bigint), public.checkin(bigint, text, timestamptz),
  public.update_task(bigint, boolean), public.proof_owner(text) from public, anon;
grant execute on function
  public.my_code(bigint),
  public.checkin(bigint, text, timestamptz),
  public.update_task(bigint, boolean),
  public.proof_owner(text)
  to authenticated;
