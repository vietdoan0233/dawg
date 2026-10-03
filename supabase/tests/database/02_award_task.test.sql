-- award_task: the only code that awards points (SDD §4, §5). Runs as the table owner, as the RPCs do.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ---------- fixtures ----------
select set_config('t.g', (select guild_id::text from members where display_name = 'Demo Captain'), true);
select set_config('t.s', (select id::text from seasons where guild_id = current_setting('t.g')::bigint and is_current), true);
insert into categories (guild_id, season_id, name) values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Fixture category');
select set_config('t.cat', (select id::text from categories where name = 'Fixture category'), true);
select set_config('t.f1', (select id::text from members where display_name = 'Demo Fuksi 1'), true);
select set_config('t.f2', (select id::text from members where display_name = 'Demo Fuksi 2'), true);
select set_config('t.tutor', (select id::text from members where display_name = 'Demo Tutor A'), true);

-- T1: 1-2p, one repeat. T2: 1p, one repeat (check-ins). T3: 1p, two repeats.
insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, requires_photo) values
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.cat')::bigint, 'T1', 1, 2, false),
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.cat')::bigint, 'T2', 1, 1, false);
insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, max_repeats, requires_photo)
  values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.cat')::bigint, 'T3', 1, 1, 2, false);
select set_config('t.t1', (select id::text from tasks where title = 'T1'), true);
select set_config('t.t2', (select id::text from tasks where title = 'T2'), true);
select set_config('t.t3', (select id::text from tasks where title = 'T3'), true);
insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
select guild_id, season_id, id, 'E-' || title, now() - interval '1 hour', now() + interval '1 hour'
  from tasks where title in ('T2', 'T3');
insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
select guild_id, season_id, id, 'E2-' || title, now() - interval '1 hour', now() + interval '1 hour'
  from tasks where title = 'T2';
select set_config('t.e2', (select id::text from events where title = 'E-T2'), true);
select set_config('t.e2b', (select id::text from events where title = 'E2-T2'), true);
select set_config('t.e3', (select id::text from events where title = 'E-T3'), true);
select set_config('t.none', '', true);

create function pg_temp.pending(p_member bigint, p_task bigint) returns bigint language sql as $$
  insert into submissions (guild_id, season_id, task_id, category_id, member_id)
  select guild_id, season_id, id, category_id, p_member from tasks where id = p_task returning id $$;
-- arguments are the NAMES of the t.* settings (except points/reason/source/submission id)
create function pg_temp.award(p_member text, p_task text, p_points int, p_reason text, p_source text,
                              p_event text, p_sub bigint default null) returns text language sql as $$
  select public.award_task(current_setting(p_member)::bigint, current_setting(p_task)::bigint, p_points, p_reason,
                           p_source, nullif(current_setting(p_event, true), '')::bigint,
                           current_setting('t.tutor')::bigint, p_sub) $$;

-- ---------- submission path ----------
select set_config('t.s1', pg_temp.pending(current_setting('t.f1')::bigint, current_setting('t.t1')::bigint)::text, true);
select is(pg_temp.award('t.f1', 't.t1', 1, null, 'submission', 't.none', current_setting('t.s1')::bigint), 'ok',
          'approving at max_repeats = 1 succeeds');
select is((select status || ':' || points_awarded || ':' || category_id || ':' || reviewed_by
             from submissions where id = current_setting('t.s1')::bigint),
          'approved:1:' || current_setting('t.cat') || ':' || current_setting('t.tutor'),
          'row is approved with points, category snapshot and reviewer');

select set_config('t.s2', pg_temp.pending(current_setting('t.f1')::bigint, current_setting('t.t1')::bigint)::text, true);
select is(pg_temp.award('t.f1', 't.t1', 1, null, 'submission', 't.none', current_setting('t.s2')::bigint), 'limit_reached',
          'approving when max_repeats is already met returns limit_reached');
select is((select status from submissions where id = current_setting('t.s2')::bigint), 'pending',
          'a limit_reached submission stays pending');

select throws_ok(format($q$select pg_temp.award('t.f2', 't.t2', 1, null, 'submission', 't.none', %s)$q$, current_setting('t.s2')),
                 '22023', 'submission_mismatch', 'a submission_id belonging to another member/task raises');
select set_config('t.s3', pg_temp.pending(current_setting('t.f2')::bigint, current_setting('t.t3')::bigint)::text, true);
select is(pg_temp.award('t.f2', 't.t3', 1, null, 'submission', 't.none', current_setting('t.s3')::bigint), 'ok',
          'max_repeats = 2 approves the first');
select throws_ok(format($q$select pg_temp.award('t.f2', 't.t3', 1, null, 'submission', 't.none', %s)$q$, current_setting('t.s3')),
                 '22023', 'submission_mismatch', 'an already-approved submission_id raises');

-- ---------- point range + reason ----------
select set_config('t.s4', pg_temp.pending(current_setting('t.f2')::bigint, current_setting('t.t1')::bigint)::text, true);
select throws_ok(format($q$select pg_temp.award('t.f2', 't.t1', 3, 'x', 'submission', 't.none', %s)$q$, current_setting('t.s4')),
                 '22023', 'points_out_of_range', 'points above points_max raise');
select throws_ok(format($q$select pg_temp.award('t.f2', 't.t1', 0, 'x', 'submission', 't.none', %s)$q$, current_setting('t.s4')),
                 '22023', 'points_out_of_range', 'points below points_min raise');
select throws_ok(format($q$select pg_temp.award('t.f2', 't.t1', 2, '  ', 'submission', 't.none', %s)$q$, current_setting('t.s4')),
                 '22023', 'reason_required', 'points above points_min need a reason');
select is(pg_temp.award('t.f2', 't.t1', 2, 'went the extra mile', 'submission', 't.none', current_setting('t.s4')::bigint), 'ok',
          'points above min with a reason succeed');
select is((select award_reason from submissions where id = current_setting('t.s4')::bigint), 'went the extra mile',
          'award_reason is stored');

-- ---------- check-in path ----------
select is(pg_temp.award('t.f1', 't.t2', 1, null, 'checkin', 't.e2'), 'ok', 'check-in awards an approved row');
select is((select count(*) from submissions where event_id = current_setting('t.e2')::bigint and status = 'approved'),
          1::bigint, 'the check-in is an approved submission row');
select is(pg_temp.award('t.f1', 't.t2', 1, null, 'checkin', 't.e2'), 'duplicate', 'double check-in -> duplicate');
select is(pg_temp.award('t.f1', 't.t2', 1, null, 'checkin', 't.e2b'), 'limit_reached',
          'a second event for a max_repeats = 1 node -> limit_reached');
select is(pg_temp.award('t.f1', 't.t3', 1, null, 'checkin', 't.e3'), 'ok', 'check-in on a repeatable node');
select throws_ok($q$select pg_temp.award('t.f1', 't.t2', 1, null, 'checkin', 't.e3')$q$,
                 '22023', 'event_task_mismatch', 'an event pointing at another node raises');

-- ---------- misuse ----------
select throws_ok($q$select pg_temp.award('t.f1', 't.t1', 1, null, 'manual', 't.none')$q$, '22023', 'invalid_source',
                 'unknown source raises');

select * from finish();
rollback;
