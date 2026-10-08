-- 0007 slice 3-4 hardening: check-in keeps scanned_at, queued-scan replay, upload quota, server-side photo hash,
-- duplicate flag, 30-day purge (SDD §5, §7 slices 3-4). Demo users supply members; nodes are fixtures below.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ---------- fixtures (as table owner) ----------
select set_config('t.g', (select guild_id::text from members where display_name = 'Demo Captain'), true);
select set_config('t.s', (select id::text from seasons where guild_id = current_setting('t.g')::bigint and is_current), true);
select set_config('t.f1', (select id::text from members where display_name = 'Demo Fuksi 1'), true);
select set_config('t.f2', (select id::text from members where display_name = 'Demo Fuksi 2'), true);
select set_config('t.code1', (select code from member_codes where member_id = current_setting('t.f1')::bigint), true);
select set_config('t.scan', (now() - interval '30 minutes')::text, true);  -- when the phone scanned it

create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;
grant execute on function pg_temp.state(text) to authenticated;
create function pg_temp.upload(p_member text, p_file text) returns text language sql as $$
  select format($q$insert into storage.objects (bucket_id, name) values ('proofs', '%s/%s/%s')$q$,
                current_setting('t.g'), current_setting(p_member), p_file) $$;
grant execute on function pg_temp.upload(text, text) to authenticated;

insert into categories (guild_id, season_id, name) values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Hx');
insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, max_repeats, requires_photo)
select current_setting('t.g')::bigint, current_setting('t.s')::bigint, c.id, v.t, 1, 1, v.rep, v.photo
  from categories c, (values ('Hx check', 1, false), ('Hx photo', 5, true)) v(t, rep, photo)
 where c.name = 'Hx' and c.guild_id = current_setting('t.g')::bigint;
insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
select guild_id, season_id, id, v.e, now() - interval '1 hour', now() + interval '1 hour'
  from tasks, (values ('Hx live'), ('Hx live 2')) v(e) where title = 'Hx check';

-- a tutor of ANOTHER guild (v4: no tutor groups, so "another group's tutor" became this)
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'xg.tutor@demo.invalid');
with g as (insert into guilds (name, slug) values ('Elsewhere Guild', 'elsewhere-guild') returning id),
     s as (insert into seasons (guild_id, name, starts_on, ends_on, is_current)
           select id, 'x', '2026-09-01', '2027-05-31', true from g returning guild_id, id)
insert into members (guild_id, season_id, user_id, email, display_name, role)
select guild_id, id, '00000000-0000-4000-8000-0000000000c1', 'xg.tutor@demo.invalid', 'Elsewhere Tutor', 'tutor' from s;
select set_config('t.live', (select id::text from events where title = 'Hx live'), true);
select set_config('t.live2', (select id::text from events where title = 'Hx live 2'), true);
select set_config('t.photo', (select id::text from tasks where title = 'Hx photo'), true);

-- ---------- slice 3: check-in audit + queued-scan replay (organizer) ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select is(public.checkin(current_setting('t.live')::bigint, current_setting('t.code1'), current_setting('t.scan')::timestamptz),
          'ok', 'a queued scan synced later still checks in');
select is(public.checkin(current_setting('t.live')::bigint, current_setting('t.code1'), current_setting('t.scan')::timestamptz),
          'duplicate', 'replaying the same queued scan (reload) is a duplicate');
select is(public.checkin(current_setting('t.live')::bigint, current_setting('t.code1'), now()),
          'duplicate', 'a second scan of the same fuksi at the same event is a duplicate');
select is(public.checkin(current_setting('t.live2')::bigint, current_setting('t.code1'), current_setting('t.scan')::timestamptz),
          'limit_reached', 'limit_reached comes back as a result, not an error (the scanner shows it and stops)');
reset role;

select is((select count(*) from submissions where member_id = current_setting('t.f1')::bigint
             and task_id = (select task_id from events where id = current_setting('t.live')::bigint)),
          1::bigint, 'the replays left exactly one check-in row');
select is((select reviewed_at from submissions where event_id = current_setting('t.live')::bigint),
          current_setting('t.scan')::timestamptz, 'the check-in keeps the phone''s scanned_at, not the replay''s');
select ok((select created_at > reviewed_at from submissions where event_id = current_setting('t.live')::bigint),
          'created_at is the sync time, so a late sync is visible');

-- ---------- slice 4: server-side hash + upload quota (fuksi 1) ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(pg_temp.state(pg_temp.upload('t.f1', 'a.jpg')), 'ok', 'a fuksi uploads a proof');
select set_config('t.sub1', public.submit_task(current_setting('t.photo')::bigint, null,
                  current_setting('t.g') || '/' || current_setting('t.f1') || '/a.jpg', repeat('f', 64))::text, true);
select is(pg_temp.state(format($$select public.submit_task(%s, null, '%s/%s/none.jpg', null)$$,
                               current_setting('t.photo'), current_setting('t.g'), current_setting('t.f1'))),
          '22023', 'a photo path still has to be uploaded (no hash needed now)');
reset role;
select is((select photo_sha256 from submissions where id = current_setting('t.sub1')::bigint), null,
          'the hash the phone sent is ignored: only the server job fills photo_sha256');

-- 19 more uploads today (as owner, skipping the policy) = 20, the daily cap
insert into storage.objects (bucket_id, name)
select 'proofs', current_setting('t.g') || '/' || current_setting('t.f1') || '/q' || i || '.jpg' from generate_series(1, 19) i;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(pg_temp.state(pg_temp.upload('t.f1', 'over.jpg')), '42501', 'the 21st upload in 24 h is refused');
reset role;
update storage.objects set created_at = now() - interval '2 days'
 where bucket_id = 'proofs' and name like current_setting('t.g') || '/' || current_setting('t.f1') || '/q1_.jpg';  -- q10..q19
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(pg_temp.state(pg_temp.upload('t.f1', 'later.jpg')), 'ok', 'uploads older than 24 h no longer count');
reset role;

-- fuksi 2 has their own quota and submits a photo too
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select is(pg_temp.state(pg_temp.upload('t.f2', 'b.jpg')), 'ok', 'the quota is per member');
select set_config('t.sub2', public.submit_task(current_setting('t.photo')::bigint, null,
                  current_setting('t.g') || '/' || current_setting('t.f2') || '/b.jpg')::text, true);
select is(pg_temp.state(format($$select public.purge_photos()$$)), '42501', 'a user cannot run the purge');
reset role;

-- ---------- duplicate flag (hashes set as the purge-photos job would) ----------
update submissions set photo_sha256 = repeat('d', 64) where id in (current_setting('t.sub1')::bigint, current_setting('t.sub2')::bigint);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(pg_temp.state(pg_temp.upload('t.f1', 'c.jpg')), 'ok', 'fuksi 1 uploads a different photo');
select set_config('t.sub3', public.submit_task(current_setting('t.photo')::bigint, null,
                  current_setting('t.g') || '/' || current_setting('t.f1') || '/c.jpg')::text, true);
reset role;
update submissions set photo_sha256 = repeat('e', 64) where id = current_setting('t.sub3')::bigint;
select set_config('t.ids', format('array[%s, %s, %s]::bigint[]', current_setting('t.sub1'), current_setting('t.sub2'), current_setting('t.sub3')), true);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select set_eq(format('select public.duplicate_photos(%s)', current_setting('t.ids')),
              format('values (%s::bigint), (%s)', current_setting('t.sub1'), current_setting('t.sub2')),
              'the tutor sees both copies of the same photo flagged, the unique one not');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
set local role authenticated;
select is_empty(format('select public.duplicate_photos(%s)', current_setting('t.ids')),
                'a tutor of another guild learns nothing about these submissions');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is_empty(format('select public.duplicate_photos(%s)', current_setting('t.ids')), 'a fuksi gets no flags');
reset role;

-- ---------- 30-day purge (service role, as the edge function calls it) ----------
update submissions set created_at = now() - interval '31 days' where id = current_setting('t.sub1')::bigint;
update storage.objects set created_at = now() - interval '31 days'
 where bucket_id = 'proofs' and name = current_setting('t.g') || '/' || current_setting('t.f1') || '/a.jpg';
set local role service_role;
select set_config('t.purged', (select string_agg(n, ',') from public.purge_photos() n), true);
reset role;
select set_eq($$select unnest(string_to_array(current_setting('t.purged'), ','))$$,
              format($$select '%s/%s/' || f from unnest(array['a.jpg','q10.jpg','q11.jpg','q12.jpg','q13.jpg','q14.jpg',
                                                               'q15.jpg','q16.jpg','q17.jpg','q18.jpg','q19.jpg']) f$$,
                     current_setting('t.g'), current_setting('t.f1')),
              'purge returns the 30-day-old photo and day-old unreferenced uploads, nothing in use or fresh');
select is((select photo_path from submissions where id = current_setting('t.sub1')::bigint), null,
          'the purged submission no longer points at a photo');
select is((select photo_sha256 from submissions where id = current_setting('t.sub1')::bigint), repeat('d', 64),
          'its hash stays, so a reused old photo is still flagged');
select isnt((select photo_path from submissions where id = current_setting('t.sub2')::bigint), null,
            'a recent submission keeps its photo');
select is((select count(*) from cron.job where jobname = 'purge-photos' and schedule = '*/10 * * * *'), 1::bigint,
          'pg_cron runs the purge-photos job every 10 minutes');

select * from finish();
rollback;
