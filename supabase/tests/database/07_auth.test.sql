-- Slice 2 (0003_auth.sql): aalto.fi hook, join_guild, invites, set_role, rotate_my_code, bootstrap_guild (SDD §1, §10).
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;
grant execute on function pg_temp.state(text) to authenticated;

-- auth users: two verified aalto accounts, one that never verified its email
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', u.confirmed,
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values ('10000000-0000-4000-8000-000000000001'::uuid, 'cap@aalto.fi',    now()),
             ('10000000-0000-4000-8000-000000000002'::uuid, 'aino.virtanen@aalto.fi', now()),
             ('10000000-0000-4000-8000-000000000003'::uuid, 'unverified@aalto.fi', null::timestamptz),
             ('10000000-0000-4000-8000-000000000004'::uuid, 'third@aalto.fi', now()),
             ('10000000-0000-4000-8000-000000000005'::uuid, 'withpassword@aalto.fi', now()),
             ('10000000-0000-4000-8000-000000000006'::uuid, 'changed@gmail.com', now())) u(id, email, confirmed);


-- ---------- hook ----------
select is(public.hook_before_user_created('{"user":{"email":"someone@gmail.com"}}') -> 'error' ->> 'http_code', '403',
          'the hook rejects a non-aalto email');
select is(public.hook_before_user_created('{"user":{"email":"x@aalto.fi.evil.com"}}') ? 'error', true,
          'the hook rejects a look-alike domain');
select is(public.hook_before_user_created('{"user":{"email":"Aino.Virtanen@Aalto.fi"}}'), '{}'::jsonb,
          'the hook accepts an aalto.fi email (any case)');
select ok(not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'EXECUTE')
          and has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'EXECUTE'),
          'only Supabase Auth can run the hook');
select is(public.hook_custom_access_token('{"authentication_method":"password","claims":{"email":"cap@aalto.fi"}}') -> 'error' ->> 'http_code',
          '403', 'password login is refused for a real account (pre-hijack)');
select is(public.hook_custom_access_token('{"authentication_method":"otp","claims":{"email":"cap@aalto.fi","sub":"x"}}'),
          '{"claims":{"email":"cap@aalto.fi","sub":"x"}}'::jsonb, 'OTP login passes the claims through unchanged');
select ok(public.hook_custom_access_token('{"authentication_method":"password","claims":{"email":"demo.captain@demo.invalid"}}') ? 'claims',
          'the seeded demo users may still use their password');
select ok(not has_function_privilege('authenticated', 'public.hook_custom_access_token(jsonb)', 'EXECUTE'),
          'clients cannot call the token hook');
select ok(not has_function_privilege('authenticated', 'public.bootstrap_guild(text,text,text)', 'EXECUTE'),
          'clients cannot bootstrap a guild');

-- ---------- bootstrap: two guilds, each with an unclaimed captain row for cap@aalto.fi ----------
select set_config('t.inv1', public.bootstrap_guild('Test Guild', 'test-guild', 'Cap@aalto.fi'), true);
select set_config('t.inv2', public.bootstrap_guild('Other Guild', 'other-guild', 'cap@aalto.fi'), true);
select set_config('t.g1', (select id::text from guilds where slug = 'test-guild'), true);
select set_config('t.g2', (select id::text from guilds where slug = 'other-guild'), true);

-- ---------- unverified email ----------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(pg_temp.state(format($$select public.join_guild(%L)$$, current_setting('t.inv1'))), '42501',
          'an unverified email cannot join');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select is(pg_temp.state(format($$select public.join_guild(%L)$$, current_setting('t.inv1'))), '42501',
          'an account whose email was changed away from aalto.fi cannot join');
reset role;
select is(pg_temp.state($$select public.bootstrap_guild('X', 'x', 'boss@gmail.com')$$), '22023',
          'bootstrap_guild refuses a non-aalto captain email');

-- ---------- the captain's email claims the captain row ----------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(public.join_guild(current_setting('t.inv1')), current_setting('t.g1')::bigint, 'the captain joins via the bootstrap invite');
select is((select role from public.members where id = public.my_member_id(current_setting('t.g1')::bigint)), 'captain',
          'the verified captain_email owner becomes captain');
select is(public.join_guild(current_setting('t.inv1')), current_setting('t.g1')::bigint,
          're-opening the link as a member is a harmless no-op (even when the invite is used up)');
select ok(public.my_code(current_setting('t.g1')::bigint) ~ '^[0-9a-f]{32}$', 'joining creates a QR code');
select set_config('t.oldcode', public.my_code(current_setting('t.g1')::bigint), true);
select isnt(public.rotate_my_code(current_setting('t.g1')::bigint), current_setting('t.oldcode'), 'rotate_my_code makes a new code');
select set_config('t.open', public.create_invite(current_setting('t.g1')::bigint), true);
select set_config('t.dead', public.create_invite(current_setting('t.g1')::bigint), true);
select lives_ok(format($$select public.revoke_invite(%L)$$, current_setting('t.dead')), 'the captain can revoke an invite');
select is((select count(*) from public.list_invites(current_setting('t.g1')::bigint)), 3::bigint, 'the captain lists the guild''s invites');
select is(pg_temp.state(format($$select public.create_invite(%s, 0)$$, current_setting('t.g1'))), '22023', 'max_uses must be at least 1');
select is(pg_temp.state(format($$select public.set_role(%s, 'fuksi')$$, public.my_member_id(current_setting('t.g1')::bigint))),
          '42501', 'a captain cannot change their own role');
reset role;
select is((select used_count from invites where code = current_setting('t.inv1')), 0, 'claiming a pre-listed row uses none of the invite');

-- ---------- someone else ----------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(pg_temp.state(format($$select public.join_guild(%L)$$, current_setting('t.dead'))), '22023', 'a revoked invite is refused');
select is(pg_temp.state($$select public.join_guild('nope')$$), '22023', 'an unknown invite is refused');
select is(public.join_guild(current_setting('t.inv2')), current_setting('t.g2')::bigint, 'a different email can use the bootstrap invite...');
select is((select role from public.members where id = public.my_member_id(current_setting('t.g2')::bigint)), 'fuksi',
          '...but only becomes a fuksi, never the captain');
select is((select display_name from public.members where guild_id = current_setting('t.g2')::bigint and role = 'captain'), 'Cap',
          'the bootstrap captain row is named after the captain''s email');
select is(public.join_guild(current_setting('t.open')), current_setting('t.g1')::bigint, 'a captain''s invite lets a new member in');
select is((select role || ' ' || display_name from public.members where id = public.my_member_id(current_setting('t.g1')::bigint)),
          'fuksi Aino Virtanen', 'a new member is a fuksi named after their email');
select is(pg_temp.state(format($$select public.create_invite(%s)$$, current_setting('t.g1'))), '42501', 'a fuksi cannot create invites');
select is(pg_temp.state(format($$select * from public.list_invites(%s)$$, current_setting('t.g1'))), '42501', 'a fuksi cannot list invites');
select is(pg_temp.state(format($$select public.set_role(%s, 'captain')$$, public.my_member_id(current_setting('t.g1')::bigint))),
          '42501', 'a fuksi cannot promote themselves');
reset role;

-- ---------- the bootstrap invite is used up, but the captain still gets in ----------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(pg_temp.state(format($$select public.join_guild(%L)$$, current_setting('t.inv2'))), '22023', 'a used-up invite is refused');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(public.join_guild(current_setting('t.inv2')), current_setting('t.g2')::bigint,
          'the pre-listed captain still claims their row after someone burned the invite');
reset role;

-- ---------- captain sets roles ----------
select set_config('t.aino', (select id::text from members where guild_id = current_setting('t.g1')::bigint and email = 'aino.virtanen@aalto.fi'), true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.set_role(current_setting('t.aino')::bigint, 'organizer');
select public.revoke_invite(current_setting('t.open'));
select is((select role from public.members where id = current_setting('t.aino')::bigint), 'organizer', 'the captain can make someone an organizer');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(public.join_guild(current_setting('t.open')), current_setting('t.g1')::bigint,
          'a member reopening their (now revoked) invite link just gets back in');
reset role;
-- the Data Guild demo captain is not a member of Test Guild
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(pg_temp.state(format($$select public.set_role(%s, 'captain')$$, current_setting('t.aino'))), '42501',
          'another guild''s captain cannot set roles here');
reset role;

select * from finish();
rollback;
