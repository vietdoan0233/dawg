-- v3.2: categories.color / categories.icon (SDD §3, §10). The screens render what is stored.
-- Uses its own categories, so it holds for any guild's data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select set_config('t.g', (select guild_id::text from members where display_name = 'Demo Captain'), true);
select set_config('t.s', (select id::text from seasons where guild_id = current_setting('t.g')::bigint and is_current), true);

create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.add(p_name text, p_color text, p_icon text) returns text language sql as $$
  select pg_temp.state(format('insert into categories (guild_id, season_id, name, color, icon) values (%s, %s, %L, %L, %L)',
                              current_setting('t.g'), current_setting('t.s'), p_name, p_color, p_icon)) $$;

-- ---------- constraints ----------
insert into categories (guild_id, season_id, name) values (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Plain');
select is((select color || ' ' || icon from categories where name = 'Plain' and guild_id = current_setting('t.g')::bigint),
          '#888888 hex', 'defaults are #888888 and hex');
select is(pg_temp.add('c1', '#ABCDEF', 'star'), '23514', 'uppercase hex is rejected (import lower()s colours)');
select is(pg_temp.add('c2', '#abc', 'star'), '23514', 'short hex is rejected');
select is(pg_temp.add('c3', 'red', 'star'), '23514', 'a colour name is rejected');
select is(pg_temp.add('c4', '#000000;background:url(x)', 'star'), '23514', 'CSS smuggled into a colour is rejected');
select is(pg_temp.add('c5', '#abcdef', 'rocket'), '23514', 'an icon outside the enum is rejected');
select is(pg_temp.add('c6', '#abcdef', 'flag'), 'ok', 'a valid colour and icon are accepted');

-- ---------- roadmap() returns the stored look, never a positional one ----------
insert into categories (guild_id, season_id, name, color, icon) values
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Look 1', '#d97706', 'cog'),
  (current_setting('t.g')::bigint, current_setting('t.s')::bigint, 'Look 2', '#2563eb', 'bell');
update categories set color = '#123abc', icon = 'star' where name = 'Look 2' and guild_id = current_setting('t.g')::bigint;
select set_config('t.ncat', (select count(*)::text from categories where guild_id = current_setting('t.g')::bigint), true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is((select c ->> 'color' || ' ' || (c ->> 'icon') from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'categories') c
            where c ->> 'name' = 'Look 2'), '#123abc star', 'roadmap() returns an edited category''s stored colour and icon');
select is((select c ->> 'color' || ' ' || (c ->> 'icon') from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'categories') c
            where c ->> 'name' = 'Look 1'), '#d97706 cog', 'roadmap() returns another category''s stored colour and icon');
select is((select count(*) from jsonb_array_elements(public.roadmap(current_setting('t.g')::bigint) -> 'categories') c
            where c ->> 'color' ~ '^#[0-9a-f]{6}$' and c ->> 'icon' is not null), current_setting('t.ncat')::bigint,
          'every category of the guild, however many tracks it has, carries a colour and icon');
select is((select color from public.categories where name = 'Plain' and guild_id = current_setting('t.g')::bigint), '#888888',
          'members can read categories.color directly');
select throws_ok($$update public.categories set color = '#ffffff'$$, '42501', 'permission denied for table categories',
                 'a client cannot edit a category''s look');

select * from finish();
rollback;
