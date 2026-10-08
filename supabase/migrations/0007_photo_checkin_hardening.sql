-- 0007_photo_checkin_hardening.sql: slice 3-4 hardening (SDD §5 retention, §7 slices 3-4).
-- Photos: 30-day purge, server-computed hash + duplicate flag, per-member upload quota.
-- Check-in: the scanned_at the phone reports is kept as reviewed_at (SDD §3: "check-in: scanner + scanned_at").

-- ---------- slice 3: keep the scan time ----------
-- 0002's checkin plus one line: an awarded check-in keeps the phone's scanned_at as reviewed_at, while
-- created_at stays the sync time, so a queued (late) check-in can be audited. award_task (0001) is untouched.
create or replace function public.checkin(p_event_id bigint, p_member_code text, p_scanned_at timestamptz)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  e public.events;
  v_member bigint;
  v_result text;
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

  v_result := public.award_task(v_member, e.task_id, (select t.points_min from public.tasks t where t.id = e.task_id),
                                null, 'checkin', e.id, public.my_member_id(e.guild_id));
  if v_result = 'ok' then
    update public.submissions set reviewed_at = p_scanned_at where event_id = e.id and member_id = v_member;
  end if;
  return v_result;
end $$;

-- ---------- slice 4: upload quota ----------
-- At most 20 proof uploads per member per 24 h. Counts the caller's own folder (proofs_select lets them see it),
-- so failed or abandoned uploads count too until the purge job removes them.
-- ponytail: two parallel uploads at 19 can both pass; a soft cap, fine against a phone looping uploads
alter policy proofs_insert on storage.objects
  with check (bucket_id = 'proofs'
              and (public.proof_owner(name))[2] = public.my_member_id((public.proof_owner(name))[1])
              and (select count(*) from storage.objects o
                    where o.bucket_id = 'proofs' and o.created_at > now() - interval '24 hours'
                      and o.name like split_part(objects.name, '/', 1) || '/' || split_part(objects.name, '/', 2) || '/%') < 20);

-- ---------- slice 4: hash on the server ----------
-- 0002's submit_task, but the phone's hash is ignored: photo_sha256 starts null and only the purge-photos edge
-- function (service role) fills it, from the stored file. p_photo_sha256 stays in the signature (SDD §4).
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
  if p_photo_path is not null then
    v_prefix := t.guild_id::text || '/' || me::text || '/';
    if left(p_photo_path, length(v_prefix)) <> v_prefix or position('..' in p_photo_path) > 0
       or length(p_photo_path) > 200 then
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
    (guild_id, season_id, task_id, category_id, member_id, note, photo_path)
  values
    (t.guild_id, t.season_id, t.id, t.category_id, me, p_note, p_photo_path)
  returning id into v_new;
  return v_new;
end $$;

-- Reviewer's flag: which of these submissions share their (server-computed) photo hash with any other submission
-- in the guild, any member, any season. Only ids the caller may review come back.
-- ponytail: exact-bytes match only; a re-encoded or cropped copy is not caught (the tutor still sees the photo)
create function public.duplicate_photos(p_ids bigint[]) returns setof bigint
language sql stable security definer set search_path = ''
as $$
  select s.id from public.submissions s
   where s.id = any (p_ids) and s.photo_sha256 is not null
     and (public.has_role(s.guild_id, array['captain']) or public.is_tutor_of(s.member_id))
     and exists (select 1 from public.submissions d
                  where d.guild_id = s.guild_id and d.photo_sha256 = s.photo_sha256 and d.id <> s.id)
$$;

-- ---------- slice 4: 30-day purge ----------
-- Called only by the purge-photos edge function (service role). Clears photo_path on submissions older than
-- 30 days, then returns the proofs objects no submission references (those just cleared, plus uploads whose
-- submit never happened) once they are a day old. The function deletes them through the Storage API, so the
-- files go too; a failed delete is simply returned again next run. photo_sha256 is kept: a hash is not a photo.
-- ponytail: the app uploads and submits in one go (no offline photo queue), so a day-old unreferenced upload is
-- abandoned; a submit landing between this select and the delete loses its photo. Widen the 1 day if photos ever queue.
create function public.purge_photos() returns setof text
language plpgsql security definer set search_path = ''
as $$
begin
  update public.submissions set photo_path = null
   where photo_path is not null and created_at < now() - interval '30 days';
  return query
    select o.name from storage.objects o
     where o.bucket_id = 'proofs' and o.created_at < now() - interval '1 day'
       and not exists (select 1 from public.submissions s where s.photo_path = o.name)
     order by o.created_at
     limit 1000;
end $$;

-- ---------- grants ----------
revoke all on function public.duplicate_photos(bigint[]), public.purge_photos() from public, anon, authenticated;
grant execute on function public.duplicate_photos(bigint[]) to authenticated;
grant execute on function public.purge_photos() to service_role;

-- ---------- schedule ----------
-- Every 10 minutes pg_cron asks the edge function to hash new photos and purge old ones. It needs two Vault
-- secrets per environment (until they exist the job does nothing):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random secret>', 'purge_photos_secret');
-- and the same secret for the function: supabase secrets set PURGE_PHOTOS_SECRET=<random secret>.
-- A dedicated secret, not the service-role key: leaking it only lets someone trigger an idempotent purge.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
select cron.schedule('purge-photos', '*/10 * * * *', $job$
  select net.http_post(url := s.url || '/functions/v1/purge-photos',
                       headers := jsonb_build_object('Authorization', 'Bearer ' || s.secret),
                       timeout_milliseconds := 60000)
    from (select (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as url,
                 (select decrypted_secret from vault.decrypted_secrets where name = 'purge_photos_secret') as secret) s
   where s.url is not null and s.secret is not null
$job$);
