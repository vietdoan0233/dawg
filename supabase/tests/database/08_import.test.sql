-- import_apply (slice 5): captain-only, defaults for omitted keys, idempotent re-import, fuksi-only roster.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select set_config('t.g', (select guild_id::text from members where display_name = 'Demo Captain'), true);
insert into guilds (name, slug) values ('Other Guild', 'other-guild');  -- the captain is not a member here
select set_config('t.other', (select id::text from guilds where slug = 'other-guild'), true);

-- the payload: one new category + task (only required keys), a tier, rules, two roster rows, balances
select set_config('t.args', $j$
  [ [{"name": "Imported Cat"}],
    [{"category_name": "imported cat", "title": "Imported task", "points_min": 1}],
    [{"name": "Imported Tier", "min_total": 999}],
    [{"category_name": "Imported Cat", "tier_name": "imported tier", "min_points": 2},
     {"category_name": "Imported Cat", "min_points": 0}],
    [{"email": "new.fuksi@aalto.fi", "display_name": "New Fuksi", "tutor_group_name": "Group Z"},
     {"email": "Other.Fuksi@aalto.fi", "display_name": "Other", "tutor_group_name": "group z", "role": "captain"}],
    [{"email": "new.fuksi@aalto.fi", "category_name": "Imported Cat", "points": 3},
     {"email": "new.fuksi@aalto.fi", "category_name": "Imported Cat", "points": 0}] ]
$j$, true);
create function pg_temp.imp() returns jsonb language sql as $$
  select public.import_apply(current_setting('t.g')::bigint, a->0, a->1, a->2, a->3, a->4, a->5)
  from (select current_setting('t.args')::jsonb a) x $$;
grant execute on function pg_temp.imp() to authenticated;

-- ---------- non-captain ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);  -- tutor
set local role authenticated;
select throws_ok($$ select pg_temp.imp() $$, '42501', 'forbidden', 'a tutor cannot import');
reset role;

-- ---------- captain ----------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(pg_temp.imp(),
  '{"categories": 1, "tasks": 1, "tiers": 1, "rules": 1, "members": 2, "adjustments": 1}'::jsonb,
  'first import creates everything (0-minimum rule and 0-point balance skipped)');
select is(pg_temp.imp(),
  '{"categories": 0, "tasks": 0, "tiers": 0, "rules": 0, "members": 2, "adjustments": 0}'::jsonb,
  're-import adds nothing new (unclaimed roster rows are just refreshed)');
select throws_ok($$ select public.import_apply(current_setting('t.g')::bigint, null, null, null, null,
                     '[{"email": "x@gmail.com"}]', null) $$, '22023', null, 'non-aalto roster email is refused');
select throws_ok($$ select public.import_apply(current_setting('t.g')::bigint, null,
                     '[{"category_name": "nope", "title": "t", "points_min": 1}]', null, null, null, null) $$,
                 '22023', null, 'unknown category is refused');
select throws_ok($$ select public.import_apply(current_setting('t.g')::bigint, null, null, null, null, null,
                     '[{"email": "ghost@aalto.fi", "category_name": "Imported Cat", "points": 1}]') $$,
                 '22023', null, 'balance for an unknown member is refused');
select lives_ok($$ select public.import_apply(current_setting('t.g')::bigint, null, null,
                    '[{"name": "Same Bar Other Name", "min_total": 999}]', null,
                    '[{"email": "new.fuksi@aalto.fi", "display_name": "New Fuksi"}]', null) $$,
                'a tier reusing a min_total is skipped, and a roster row without a group keeps its group');
select throws_ok($$ select public.import_apply(current_setting('t.other')::bigint, null, null, null, null, null, null) $$,
                 '42501', 'forbidden', 'a captain cannot import into another guild');
reset role;

select is((select g.name from members m join tutor_groups g on g.id = m.tutor_group_id where m.email = 'new.fuksi@aalto.fi'),
          'Group Z', 'blank tutor group on re-import does not wipe the existing one');
select ok(not exists (select 1 from tiers where name = 'Same Bar Other Name'), 'colliding tier was skipped');

select is((select requires_photo::text || reviewer || max_repeats || points_max from tasks where title = 'Imported task'),
          'truetutor11', 'omitted task keys take the column defaults');
select is((select count(*) from tutor_groups where guild_id = current_setting('t.g')::bigint and lower(name) = 'group z'),
          1::bigint, 'tutor groups match case-insensitively');
select is((select array_agg(distinct role) from members where email in ('new.fuksi@aalto.fi', 'other.fuksi@aalto.fi')),
          array['fuksi'], 'a roster "role" column never grants a staff role');
select is((select sum(a.points) from adjustments a join members m on m.id = a.member_id
            where m.email = 'new.fuksi@aalto.fi'), 3::bigint, 'opening balance imported once');
select is((select a.reason from adjustments a join members m on m.id = a.member_id where m.email = 'new.fuksi@aalto.fi'),
          'Opening balance', 'default adjustment reason');
select is((select a.created_by from adjustments a join members m on m.id = a.member_id where m.email = 'new.fuksi@aalto.fi'),
          (select id from members where display_name = 'Demo Captain'), 'created_by is the importing captain');

select ok(not exists (select 1 from pg_class where relname = 'import_history'), 'import_history is gone');
select ok(not has_function_privilege('anon', 'public.import_apply(bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)', 'execute'),
          'anon cannot call import_apply');

select * from finish();
rollback;
