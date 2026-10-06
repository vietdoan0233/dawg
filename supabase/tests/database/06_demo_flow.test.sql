-- 0002 demo flow: checkin, my_code, update_task reveal, proofs storage policies (SDD §4, §5, §7 slices 3-5).
-- Guild-agnostic: demo users supply members; nodes and events are fixtures created below.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ---------- fixtures (as table owner) ----------
select set_config('t.g', (select guild_id::text from members where display_name = 'Demo Captain'), true);
select set_config('t.s', (select id::text from seasons where guild_id = current_setting('t.g')::bigint and is_current), true);
select set_config('t.f1', (select id::text from members where display_name = 'Demo Fuksi 1'), true);
select set_config('t.f2', (select id::text from members where display_name = 'Demo Fuksi 2'), true);
select set_config('t.code1', (select code from member_codes where member_id = current_setting('t.f1')::bigint), true);
select set_config('t.code3', (select c.code from member_codes c join members m on m.id = c.member_id where m.display_name = 'Demo Fuksi 3'), true);
select set_config('t.tutorcode', (select c.code from member_codes c join members m on m.id = c.member_id where m.display_name = 'Demo Tutor A'), true);

create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

insert into categories (guild_id, season_id, name) values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Fx');
insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, requires_photo, revealed_at)
select current_setting('t.g')::bigint, current_setting('t.s')::bigint, c.id, v.t, 2, 2, false, v.rv::timestamptz
  from categories c, (values ('Fx open', 'now'), ('Fx secret', 'infinity')) v(t, rv)
 where c.name = 'Fx' and c.guild_id = current_setting('t.g')::bigint;
insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
select guild_id, season_id, id, v.e, now() + v.s::interval, now() + v.en::interval
  from tasks, (values ('Fx open', 'Fx live', '-1 hour', '1 hour'),
                      ('Fx open', 'Fx live 2', '-1 hour', '1 hour'),
                      ('Fx open', 'Fx past', '-10 hours', '-5 hours'),
                      ('Fx secret', 'Fx secret live', '-1 hour', '1 hour')) v(task, e, s, en)
 where title = v.task;
select set_config('t.live', (select id::text from events where title = 'Fx live'), true);
select set_config('t.live2', (select id::text from events where title = 'Fx live 2'), true);
select set_config('t.past', (select id::text from events where title = 'Fx past'), true);
select set_config('t.secretev', (select id::text from events where title = 'Fx secret live'), true);
select set_config('t.secret', (select id::text from tasks where title = 'Fx secret'), true);
insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, requires_photo, active)
select guild_id, season_id, category_id, v.t, 1, 1, v.photo, v.active
  from tasks, (values ('Fx photo', true, true), ('Fx retired', false, false)) v(t, photo, active) where title = 'Fx open';
insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
select guild_id, season_id, id, 'Fx retired live', now() - interval '1 hour', now() + interval '1 hour' from tasks where title = 'Fx retired';
select set_config('t.photo', (select id::text from tasks where title = 'Fx photo'), true);
select set_config('t.basic_open', (select id::text from tasks where title = 'Fx open'), true);
select set_config('t.retiredev', (select id::text from events where title = 'Fx retired live'), true);
grant execute on function pg_temp.state(text) to authenticated;

-- ---------- fuksi ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(public.my_code(current_setting('t.g')::bigint), current_setting('t.code1'), 'my_code returns the caller''s own code');
select is(pg_temp.state(format($$select public.checkin(%s, %L, now())$$, current_setting('t.live'), current_setting('t.code3'))),
          '42501', 'a fuksi cannot check people in');
select is(pg_temp.state(format($$select public.update_task(%s, true)$$, current_setting('t.secret'))),
          '42501', 'a fuksi cannot reveal a node');
select is(pg_temp.state(format($$insert into storage.objects (bucket_id, name) values ('proofs', '%s/%s/a.jpg')$$,
                               current_setting('t.g'), current_setting('t.f1'))),
          'ok', 'a fuksi can upload into their own proofs folder');
select is(pg_temp.state(format($$insert into storage.objects (bucket_id, name) values ('proofs', '%s/%s/b.jpg')$$,
                               current_setting('t.g'), current_setting('t.f2'))),
          '42501', 'a fuksi cannot upload into another member''s folder');
select is(pg_temp.state($$insert into storage.objects (bucket_id, name) values ('proofs', 'x/../1/c.jpg')$$),
          '42501', 'a malformed proofs path is rejected');
select is(pg_temp.state(format($$select public.submit_task(%s, null, '%s/%s/never-uploaded', repeat('a', 64))$$,
                               current_setting('t.photo'), current_setting('t.g'), current_setting('t.f1'))),
          '22023', 'submit_task rejects a photo path that was never uploaded');
select is(pg_temp.state(format($$select public.submit_task(%s, null, '%s/%s/a.jpg', repeat('a', 64))$$,
                               current_setting('t.photo'), current_setting('t.g'), current_setting('t.f1'))),
          'ok', 'submit_task accepts an uploaded photo');
select is(pg_temp.state(format($$select public.submit_task(%s, null, '%s/%s/a.jpg', repeat('b', 64))$$,
                               current_setting('t.basic_open'), current_setting('t.g'), current_setting('t.f1'))),
          '22023', 'one photo cannot back a second submission');
reset role;

-- ---------- organizer ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select is(public.my_code(current_setting('t.g')::bigint) is not null, true, 'staff also have a code (it never awards: non-fuksi)');
select is(public.checkin(current_setting('t.live')::bigint, current_setting('t.code1'), now()), 'ok', 'check-in awards the node');
select is(public.checkin(current_setting('t.live')::bigint, current_setting('t.code1'), now()), 'duplicate', 'scanning twice is a duplicate');
select is(public.checkin(current_setting('t.live2')::bigint, current_setting('t.code1'), now()), 'limit_reached',
          'a second event for a max_repeats = 1 node is limit_reached');
select is(public.checkin(current_setting('t.live')::bigint, 'nope', now()), 'unknown', 'an unknown code is unknown');
select is(public.checkin(current_setting('t.live')::bigint, current_setting('t.tutorcode'), now()), 'unknown',
          'a non-fuksi code is unknown');
select is(public.checkin(current_setting('t.live')::bigint, current_setting('t.code3'), now() - interval '25 hours'),
          'outside_window', 'a scan older than 24 h is outside_window');
select is(public.checkin(current_setting('t.past')::bigint, current_setting('t.code3'), now()),
          'outside_window', 'a scan more than 2 h after the event is outside_window');
select is(public.checkin(current_setting('t.secretev')::bigint, current_setting('t.code1'), now()), 'ok',
          'check-in at a hidden node''s event still awards');
select is(pg_temp.state(format($$select public.checkin(%s, %L, now())$$, current_setting('t.retiredev'), current_setting('t.code3'))),
          '42501', 'a retired node awards nothing by check-in');
select is(pg_temp.state(format($$select public.update_task(%s, true)$$, current_setting('t.secret'))),
          '42501', 'an organizer cannot reveal a node');
reset role;

select is((select count(*) from submissions where member_id = current_setting('t.f1')::bigint and event_id is not null
              and status = 'approved' and points_awarded = 2 and reviewed_by = (select id from members where display_name = 'Demo Organizer')),
          2::bigint, 'check-ins are approved at points_min with the scanner as reviewer');

-- ---------- photo visibility: tutor B (other group) vs tutor A (fuksi 1's tutor) ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'proofs'), 0::bigint, 'another group''s tutor cannot see the photo');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'proofs'), 1::bigint, 'the member''s tutor can see the photo');
reset role;

-- ---------- reveal ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select is((select count(*) from public.tasks where title = 'Fx secret'), 0::bigint, 'the secret is hidden before reveal');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.update_task(current_setting('t.secret')::bigint, true);
select is(pg_temp.state(format($$select public.update_task(%s, true)$$, (select id from public.tasks where title = 'Fx retired'))),
          '42501', 'a retired node cannot be revealed');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select is((select count(*) from public.tasks where title = 'Fx secret'), 1::bigint, 'the captain''s reveal shows it to every fuksi');
reset role;
select ok((select revealed_at <= now() from tasks where title = 'Fx secret'), 'reveal sets revealed_at to now');

select * from finish();
rollback;
