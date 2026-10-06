-- Optional demo dataset (local/demo projects ONLY; runs on `supabase db reset`).
-- It is DATA for one guild, "Data Guild", as a first demo. Nothing in the schema, RPCs, app or tests
-- depends on these names: any guild's categories, nodes, tiers and rules are rows like these.
-- The demo users share a known password, so never seed a pilot project (the seed refuses to run on a
-- non-empty database).
--
-- Only facts written in docs/fuksipisteet/{SDD,ARCHITECTURE-SIMPLE}.md are seeded. The Data Guild roadmap
-- image (`fuksi point roadmap for Data Guild.jpg`) is not in the repo, so every node whose points the docs
-- do not state is NOT seeded, and no roadmap entry is invented. Missing input is listed in the README
-- ("Slice 1 status").

do $seed$
declare
  g bigint; s bigint;
  c_mandatory bigint; c_work bigint; c_party bigint; c_culture bigint; c_guild bigint; c_other bigint;
  grp_a bigint; grp_b bigint;
begin
  -- fail safe: the demo users share a known password, so never seed a database that holds anything
  if exists (select 1 from public.guilds) or exists (select 1 from auth.users where email not like '%@demo.invalid') then
    raise exception 'seed.sql refuses to run on a non-empty database (local/demo projects only)';
  end if;

  insert into guilds (name, slug) values ('Data Guild', 'data-guild') returning id into g;

  -- DEMO PLACEHOLDER dates, pending Data Guild confirmation: the docs say only "Sept -> May", Wappu = May 1st.
  insert into seasons (guild_id, name, starts_on, ends_on, is_current)
  values (g, '2026-27', '2026-09-01', '2027-05-31', true) returning id into s;

  -- Categories in map order (display order = id). Colour/icon are the default palette in map order
  -- (the six icons of the DG map, in the order the docs list the tracks); the app renders what is stored.
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Mandatory',            '#d97706', 'cog')    returning id into c_mandatory;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Work',                 '#2563eb', 'bell')   returning id into c_work;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Party & Orienteering', '#db2777', 'goblet') returning id into c_party;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Teekkari Culture',     '#7c3aed', 'tower')  returning id into c_culture;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Guild',                '#059669', 'shield') returning id into c_guild;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Other Events',         '#475569', 'hex')    returning id into c_other;

  -- Tiers (ARCHITECTURE-SIMPLE "Levels")
  insert into tiers (guild_id, season_id, name, min_total) values (g, s, 'Teekkari', 40);
  insert into tiers (guild_id, season_id, name, min_total) values
    (g, s, 'Fuksi Doctor', 60), (g, s, 'Double Doctor', 80), (g, s, 'Fuksi Professor', 100);

  -- Category minimums ("Need at least"). Party & Orienteering is [0] -> no rule. tier_id null = every tier
  -- (they sum to 40; whether higher tiers need them is SDD §9 Q3).
  insert into rules (guild_id, season_id, category_id, min_points) values
    (g, s, c_mandatory, 6), (g, s, c_work, 2), (g, s, c_culture, 14), (g, s, c_guild, 12), (g, s, c_other, 6);

  -- Nodes: ONE temporary demo node. PLACEHOLDER: its title, category and 2p are inferred (SDD §3 says
  -- "Sitsit: Work 2p + Culture 1p" and the Work track lists "Work at Sitsit"; no doc ties them together),
  -- so Data Guild must confirm or replace it.
  -- requires_photo = false only because photo capture is slice 4; flip it to the default when it lands.
  insert into tasks (guild_id, season_id, category_id, title, description, points_min, points_max, requires_photo)
  values (g, s, c_work, 'Work at Sitsit',
          'PLACEHOLDER demo node: the title, category and 2p are inferred from the docs, not confirmed by Data Guild.',
          2, 2, false);

  -- DEMO PLACEHOLDER nodes for the 3-minute demo (SDD §7), NOT Data Guild's real map: replace them with the
  -- roadmap data when it arrives. Each one exercises a feature: check-in, photo + range, write-in, keyhole.
  insert into tasks (guild_id, season_id, category_id, title, description, points_min, points_max,
                     max_repeats, requires_photo, requires_note, revealed_at)
  values
    (g, s, c_mandatory, 'Orientation lecture', 'DEMO PLACEHOLDER: check in at the event.',          2, 2, 1, false, false, now()),
    (g, s, c_party,     'Sitsit',              'DEMO PLACEHOLDER: check in at the event.',          1, 1, 1, false, false, now()),
    (g, s, c_guild,     'Guild sauna evening', 'DEMO PLACEHOLDER: photo proof, tutor picks 1-3p.',  1, 3, 1, true,  false, now()),
    (g, s, c_culture,   'Teekkari song night', 'DEMO PLACEHOLDER: photo proof.',                    2, 2, 1, true,  false, now()),
    (g, s, c_other,     '+ my own event',      'DEMO PLACEHOLDER: write the event name.',           1, 1, 8, false, true,  now()),
    (g, s, c_culture,   'Keyhole: the secret', 'DEMO PLACEHOLDER: hidden until the captain reveals it.', 3, 3, 1, false, false, 'infinity');

  -- events run "now" so the demo check-in is inside the +-2 h window whenever the seed runs
  insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
  select g, s, t.id, t.title, now() - interval '1 hour', now() + interval '6 hours'
    from tasks t where t.guild_id = g and t.title in ('Orientation lecture', 'Sitsit');

  -- Demo roster
  insert into tutor_groups (guild_id, season_id, name) values (g, s, 'Group A') returning id into grp_a;
  insert into tutor_groups (guild_id, season_id, name) values (g, s, 'Group B') returning id into grp_b;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
         extensions.crypt('demo-password', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from (values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'demo.captain@demo.invalid'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'demo.tutor.a@demo.invalid'),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'demo.tutor.b@demo.invalid'),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'demo.fuksi.1@demo.invalid'),
    ('00000000-0000-4000-8000-000000000005'::uuid, 'demo.fuksi.2@demo.invalid'),
    ('00000000-0000-4000-8000-000000000006'::uuid, 'demo.fuksi.3@demo.invalid'),
    ('00000000-0000-4000-8000-000000000007'::uuid, 'demo.organizer@demo.invalid')) u(id, email);

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id, u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
  from auth.users u where u.email like '%@demo.invalid';

  insert into members (guild_id, season_id, user_id, email, display_name, role, tutor_group_id)
  select g, s, u.id, u.email, u.display_name, u.role, u.grp
  from (values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'demo.captain@demo.invalid',  'Demo Captain', 'captain', null::bigint),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'demo.tutor.a@demo.invalid',  'Demo Tutor A', 'tutor',   grp_a),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'demo.tutor.b@demo.invalid',  'Demo Tutor B', 'tutor',   grp_b),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'demo.fuksi.1@demo.invalid',  'Demo Fuksi 1', 'fuksi',   grp_a),
    ('00000000-0000-4000-8000-000000000005'::uuid, 'demo.fuksi.2@demo.invalid',  'Demo Fuksi 2', 'fuksi',   grp_a),
    ('00000000-0000-4000-8000-000000000006'::uuid, 'demo.fuksi.3@demo.invalid',  'Demo Fuksi 3', 'fuksi',   grp_b),
    ('00000000-0000-4000-8000-000000000007'::uuid, 'demo.organizer@demo.invalid', 'Demo Organizer', 'organizer', null)
  ) u(id, email, display_name, role, grp);

  insert into member_codes (member_id) select id from members where guild_id = g;
end
$seed$;
