-- Slice 1 flow: submit -> review -> roadmap -> leaderboard, secret nodes, tiers (SDD §3-§6).
-- Guild-agnostic: the demo users supply members; every category, node, tier and rule
-- used here is a generic fixture created below, so replacing the demo dataset cannot break this file.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

-- ---------- fixtures (as table owner) ----------
select set_config('t.g', (select guild_id::text from members where display_name = 'Demo Captain'), true);
select set_config('t.s', (select id::text from seasons where guild_id = current_setting('t.g')::bigint and is_current), true);
select set_config('t.f1', (select id::text from members where display_name = 'Demo Fuksi 1'), true);
select set_config('t.f2', (select id::text from members where display_name = 'Demo Fuksi 2'), true);
select set_config('t.f3', (select id::text from members where display_name = 'Demo Fuksi 3'), true);
select set_config('t.tutor', (select id::text from members where display_name = 'Demo Tutor A'), true);

create function pg_temp.cat(p text) returns bigint language sql as $$
  select id from categories where name = p and guild_id = current_setting('t.g')::bigint $$;
create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

-- this file defines its own levels and category minimums
delete from rules where guild_id = current_setting('t.g')::bigint;
delete from tiers where guild_id = current_setting('t.g')::bigint;

insert into categories (guild_id, season_id, name) values
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Cat A'),
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Cat B'),
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Cat C');
insert into tiers (guild_id, season_id, name, min_total) values
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'L1', 10),
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'L2', 20),
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'L3', 30);
-- A >= 3 and B >= 2 for every level; reaching L2 (and above) also needs C >= 8
insert into rules (guild_id, season_id, category_id, tier_id, min_points)
select current_setting('t.g')::bigint, current_setting('t.s')::bigint, pg_temp.cat(c), (select id from tiers where name = t and guild_id = current_setting('t.g')::bigint), m
from (values ('Cat A', null, 3), ('Cat B', null, 2), ('Cat C', 'L2', 8)) v(c, t, m);

insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, reviewer, requires_photo, requires_note, revealed_at)
select current_setting('t.g')::bigint, current_setting('t.s')::bigint, pg_temp.cat(c), t, lo, hi, rev, photo, note, rv::timestamptz
from (values
  ('Cat A', 'Basic',   2,  2, 'tutor',   false, false, 'now'),
  ('Cat A', 'Range',   1,  2, 'tutor',   false, false, 'now'),
  ('Cat A', 'Captain', 1, 10, 'captain', false, false, 'now'),
  ('Cat A', 'Note',    1,  1, 'tutor',   false, true,  'now'),
  ('Cat A', 'Photo',   1,  1, 'tutor',   true,  false, 'now'),
  ('Cat B', 'Secret',  1,  1, 'tutor',   false, false, 'infinity')) v(c, t, lo, hi, rev, photo, note, rv);
select set_config('t.basic',   (select id::text from tasks where title = 'Basic'), true);
select set_config('t.range',   (select id::text from tasks where title = 'Range'), true);
select set_config('t.captain', (select id::text from tasks where title = 'Captain'), true);
select set_config('t.note',    (select id::text from tasks where title = 'Note'), true);
select set_config('t.photo',   (select id::text from tasks where title = 'Photo'), true);
select set_config('t.secret',  (select id::text from tasks where title = 'Secret'), true);
insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
select guild_id, season_id, id, 'Secret event', now() - interval '1 hour', now() + interval '1 hour'
  from tasks where title = 'Secret';

select is(pg_temp.state($$insert into tasks (guild_id, season_id, category_id, title, points_min, points_max)
          select guild_id, season_id, category_id, 'Wide', 1, 10 from tasks where title = 'Range'$$),
          '23514', 'a wide range with a tutor reviewer violates the schema CHECK');

-- ---------- fuksi 1: submit ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;

select set_config('t.sub1', public.submit_task(current_setting('t.basic')::bigint)::text, true);
select is((select status from public.submissions where id = current_setting('t.sub1')::bigint), 'pending',
          'submit_task inserts a pending submission');
select is((select n ->> 'status' from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'nodes') n
            where n ->> 'title' = 'Basic'), 'pending', 'the node is half-lit while pending');
select throws_ok(format('select public.submit_task(%s)', current_setting('t.basic')), '23P01', 'limit_reached',
                 'submitting past max_repeats raises limit_reached');
select throws_ok(format('select public.submit_task(%s, ''   '')', current_setting('t.note')), '22023', 'note_required',
                 'requires_note rejects a blank note');
select lives_ok(format('select public.submit_task(%s, ''an event name'')', current_setting('t.note')),
                'requires_note accepts a note');
select throws_ok(format('select public.submit_task(%s)', current_setting('t.photo')), '22023', 'photo_required',
                 'requires_photo rejects a missing photo');
select throws_ok(format('select public.submit_task(%s, null, ''%s/999/x.jpg'', repeat(''a'', 64))',
                        current_setting('t.photo'), current_setting('t.g')), '22023', 'invalid_photo',
                 'a photo path outside the caller''s folder is rejected');
select throws_ok(format('select public.submit_task(%s, null, ''%s/%s/x.jpg'', ''nothex'')',
                        current_setting('t.photo'), current_setting('t.g'), current_setting('t.f1')), '22023', 'invalid_photo',
                 'a malformed SHA-256 is rejected');
-- 0002: the photo must really be uploaded first (the fuksi's own folder; proofs_insert allows it)
insert into storage.objects (bucket_id, name) values ('proofs', current_setting('t.g') || '/' || current_setting('t.f1') || '/x.jpg');
select lives_ok(format('select public.submit_task(%s, null, ''%s/%s/x.jpg'', repeat(''a'', 64))',
                       current_setting('t.photo'), current_setting('t.g'), current_setting('t.f1')),
                'a photo under the caller''s folder is accepted');
select throws_ok(format('select public.submit_task(%s)', current_setting('t.secret')), 'P0002', 'not_found',
                 'a hidden task cannot be claimed by id');
select throws_ok($$insert into public.submissions (guild_id, season_id, task_id, category_id, member_id, status, points_awarded)
                   values (1, 1, 1, 1, 1, 'approved', 100)$$, '42501', 'permission denied for table submissions',
                 'a client cannot write points directly');
select is((select count(*) from public.tasks where title = 'Secret'), 0::bigint, 'hidden task title is unreadable');
select is((select count(*) from public.events where title = 'Secret event'), 0::bigint, 'hidden event is unreadable');
select is((select count(*) from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'nodes') n
            where (n ->> 'locked')::boolean and not (n ? 'title') and not (n ? 'points_min')
              and (n ->> 'category_id')::bigint = (select id from public.categories
                                                    where name = 'Cat B' and guild_id = current_setting('t.g')::bigint)), 1::bigint,
          'roadmap() shows the hidden node as a locked placeholder without title or points');
-- Slice 1 is self-submission only: the signature keeps with_member_ids, a non-empty array is refused
select throws_ok(format('select public.submit_task(%s, null, null, null, array[%s])', current_setting('t.range'), current_setting('t.f3')),
                 '0A000', 'group_submit_unsupported', 'group submission is refused (fuksi 3)');
select throws_ok(format('select public.submit_task(%s, null, null, null, array[%s])', current_setting('t.range'), current_setting('t.f2')),
                 '0A000', 'group_submit_unsupported', 'group submission is refused (fuksi 2)');
select set_config('t.range1s', public.submit_task(current_setting('t.range')::bigint)::text, true);

-- ---------- fuksi 2: isolation ----------
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select set_config('t.range2s', public.submit_task(current_setting('t.range')::bigint)::text, true);
select is((select count(*) from public.submissions where member_id = current_setting('t.f1')::bigint), 0::bigint,
          'a fuksi cannot read another fuksi''s submissions');
select throws_ok(format('select * from public.review_submissions(array[%s], true)', current_setting('t.sub1')),
                 '42501', 'forbidden', 'a fuksi cannot review');

-- ---------- tutor B: no tutor groups (v4), every tutor reviews every fuksi of the guild ----------
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select ok((select count(*) from public.submissions where member_id = current_setting('t.f1')::bigint) >= 4,
          'any tutor of the guild sees fuksi 1''s submissions');
select is((select result from public.review_submissions(
            array[(select id from public.submissions where task_id = current_setting('t.note')::bigint)], false)),
          'rejected', 'tutor B can review fuksi 1');

-- ---------- tutor A: review ----------
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select ok((select count(*) from public.submissions where status = 'pending') >= 4, 'a tutor sees the guild''s pending submissions');
select is((select result from public.review_submissions(array[current_setting('t.sub1')::bigint], true)), 'ok',
          'approve defaults to points_min and lights the node');
select is((select result from public.review_submissions(array[current_setting('t.sub1')::bigint], true)), 'already_reviewed',
          'only pending rows are reviewable: a re-approve reports already_reviewed');
select is((select result from public.review_submissions(array[current_setting('t.sub1')::bigint], false)), 'already_reviewed',
          'a stale reject of an approved row reports already_reviewed, not rejected');
select is((select status from public.submissions where id = current_setting('t.sub1')::bigint), 'approved',
          'and the approved row is untouched');
select is((select points_awarded from public.submissions where id = current_setting('t.sub1')::bigint), 2,
          'with its original points');
select throws_ok('select * from public.review_submissions(array[999999], true)', '42501', 'forbidden',
                 'an unknown submission id looks like an unauthorised one');
select is((select points_awarded from public.submissions where id = current_setting('t.sub1')::bigint), 2,
          'the node awarded its fixed 2p');

select throws_ok(format('select * from public.review_submissions(array[%s], true, 2)', current_setting('t.range1s')),
                 '22023', 'reason_required', 'picking above min needs a reason');
select throws_ok(format('select * from public.review_submissions(array[%s], true, 3, ''x'')', current_setting('t.range1s')),
                 '22023', 'points_out_of_range', 'points outside the node range are rejected');
select is((select result from public.review_submissions(array[current_setting('t.range1s')::bigint], true, 2, 'a good reason')),
          'ok', 'approve with a stepped value and a reason');
select is((select result from public.review_submissions(array[current_setting('t.range2s')::bigint], false)), 'rejected',
          'reject sets rejected');
select is((select status || ':' || coalesce(points_awarded::text, 'null') from public.submissions
            where id = current_setting('t.range2s')::bigint), 'rejected:null', 'a rejected row awards nothing');

-- ---------- captain-reviewed node ----------
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select set_config('t.cap1', public.submit_task(current_setting('t.captain')::bigint)::text, true);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(format('select * from public.review_submissions(array[%s], true)', current_setting('t.cap1')),
                 '42501', 'forbidden', 'a tutor cannot review a captain-reviewed node');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select result from public.review_submissions(array[current_setting('t.cap1')::bigint], true, 7, 'a wide-range award')), 'ok',
          'the captain reviews a wide-range node');
select is((select count(*) from public.submissions where task_id = current_setting('t.range')::bigint), 2::bigint,
          'the captain sees the whole guild');
select is((select count(*) from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'nodes') n
            where n ->> 'title' = 'Secret'), 1::bigint, 'staff see secret nodes in the roadmap');

-- ---------- fuksi 1: map + leaderboard ----------
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is((select n ->> 'status' from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'nodes') n
            where n ->> 'title' = 'Basic'), 'lit', 'the node lights up after approval');
select is((public.roadmap(current_setting('t.g')::bigint) ->> 'total')::int, 2 + 2 + 7, 'roadmap total sums approved points');
select is((select (c ->> 'points')::int from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'categories') c
            where c ->> 'name' = 'Cat A'), 11, 'category progress uses the snapshotted category');
select is((select total from public.leaderboard(current_setting('t.g')::bigint) where member_id = current_setting('t.f1')::bigint),
          11, 'leaderboard shows fuksi 1''s individual total');
select is((select total from public.leaderboard(current_setting('t.g')::bigint) where member_id = current_setting('t.f3')::bigint),
          0, 'leaderboard includes fuksis with no points');

-- ---------- secret nodes: owner sees after check-in; everyone after reveal ----------
reset role;
do $$ begin
  perform public.award_task(current_setting('t.f1')::bigint, current_setting('t.secret')::bigint, 1, null, 'checkin',
                            (select id from events where title = 'Secret event'), current_setting('t.tutor')::bigint);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is((select count(*) from public.tasks where title = 'Secret'), 1::bigint, 'the owner of a check-in can see the secret node');
select is((select count(*) from public.events where title = 'Secret event'), 1::bigint, 'and its event');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select is((select count(*) from public.tasks where title = 'Secret'), 0::bigint, 'other fuksis still cannot');
reset role;
update tasks set revealed_at = now() where title = 'Secret';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select is((select count(*) from public.tasks where title = 'Secret'), 1::bigint, 'after the reveal everyone can');

-- ---------- tiers (SDD §3 member_tier): cumulative rules, totals, required nodes ----------
-- levels L1/L2/L3 = 10/20/30p; every level needs A >= 3 and B >= 2; L2 and above also need C >= 8
reset role;
-- f3: A 3, B 2, C 4 = 9 -> below the lowest level
insert into adjustments (guild_id, season_id, member_id, category_id, points, reason)
select current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.f3')::bigint, pg_temp.cat(c), p, 'test'
from (values ('Cat A', 3), ('Cat B', 2), ('Cat C', 4)) v(c, p);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.member_tier where member_id = current_setting('t.f3')::bigint), 0::bigint,
          'below the lowest level: no row');
reset role;
insert into adjustments (guild_id, season_id, member_id, category_id, points, reason)
values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.f3')::bigint, pg_temp.cat('Cat C'), 1, 'test');
set local role authenticated;
select is((select t.name from public.member_tier mt join public.tiers t on t.id = mt.tier_id
            where mt.member_id = current_setting('t.f3')::bigint), 'L1', 'the first threshold with every category minimum -> L1');
reset role;
-- 20p total, but C is 5 < 8: L2's own rule is unmet
insert into adjustments (guild_id, season_id, member_id, category_id, points, reason)
values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.f3')::bigint, pg_temp.cat('Cat A'), 10, 'test');
set local role authenticated;
select is((select t.name from public.member_tier mt join public.tiers t on t.id = mt.tier_id
            where mt.member_id = current_setting('t.f3')::bigint), 'L1', '20p without the level''s own rule stays L1');
reset role;
insert into adjustments (guild_id, season_id, member_id, category_id, points, reason)
values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.f3')::bigint, pg_temp.cat('Cat C'), 3, 'test');
set local role authenticated;
select is((select t.name from public.member_tier mt join public.tiers t on t.id = mt.tier_id
            where mt.member_id = current_setting('t.f3')::bigint), 'L2', 'meeting the level''s rule reaches L2');
reset role;
-- f2: 34p total but C is 4 < 8: L3 also needs L2's rule (cumulative), so only L1
insert into adjustments (guild_id, season_id, member_id, category_id, points, reason)
select current_setting('t.g')::bigint, current_setting('t.s')::bigint, current_setting('t.f2')::bigint, pg_temp.cat(c), p, 'test'
from (values ('Cat A', 28), ('Cat B', 2), ('Cat C', 4)) v(c, p);
set local role authenticated;
select is((select t.name from public.member_tier mt join public.tiers t on t.id = mt.tier_id
            where mt.member_id = current_setting('t.f2')::bigint), 'L1', 'level rules are cumulative: 34p cannot skip L2''s rule');
reset role;
-- a required node blocks the level until approved
insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, required, requires_photo)
values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, pg_temp.cat('Cat A'), 'Req', 1, 1, true, false);
set local role authenticated;
select is((select count(*) from public.member_tier where member_id = current_setting('t.f3')::bigint), 0::bigint,
          'an unfinished required node removes the level');
select is(public.required_missing(current_setting('t.f3')::bigint), true, 'the captain sees an outstanding required node');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);   -- tutor B
set local role authenticated;
select is(public.required_missing(current_setting('t.f3')::bigint), true, 'a tutor of the guild sees it');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);   -- tutor A
set local role authenticated;
select is(public.required_missing(current_setting('t.f3')::bigint), true, 'tutor A does learn it too (no groups, v4)');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);   -- fuksi 1
set local role authenticated;
select is(public.required_missing(current_setting('t.f3')::bigint), true,
          'levels are public in the guild, so another fuksi learns it as well (v4)');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000006', true);   -- f3 itself
set local role authenticated;
select is(public.required_missing(current_setting('t.f3')::bigint), true, 'a member sees their own');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);   -- back to the captain
reset role;
insert into submissions (guild_id, season_id, task_id, category_id, member_id)
select guild_id, season_id, id, category_id, current_setting('t.f3')::bigint from tasks where title = 'Req';
do $$ begin
  perform public.award_task(current_setting('t.f3')::bigint, (select id from tasks where title = 'Req'), 1, null, 'submission', null,
                            current_setting('t.tutor')::bigint,
                            (select id from submissions where task_id = (select id from tasks where title = 'Req')));
end $$;
set local role authenticated;
select is((select t.name from public.member_tier mt join public.tiers t on t.id = mt.tier_id
            where mt.member_id = current_setting('t.f3')::bigint), 'L2', 'the level returns once the required node is approved');

select * from finish();
rollback;
