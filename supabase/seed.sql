-- Optional demo dataset (local/demo projects ONLY; runs on `supabase db reset`).
-- It is DATA for one guild, "Data Guild", as a first demo. Nothing in the schema, RPCs, app or tests
-- depends on these names: any guild's categories, nodes, tiers and rules are rows like these.
-- The demo users share a known password, so never seed a pilot project (the seed refuses to run on a
-- non-empty database).
--
-- Nodes, points, tracks, tiers and minimums are transcribed from Data Guild's real roadmap
-- (`fuksi point roadmap for Data Guild.jpg`). Still unconfirmed: season dates, write-in points, which nodes
-- need a photo vs a check-in, the jäynä ceiling, and what the 4 secret keyholes are (SDD §9).

do $seed$
declare
  g bigint; s bigint;
  c_mandatory bigint; c_work bigint; c_party bigint; c_culture bigint; c_guild bigint; c_other bigint;
begin
  -- fail safe: the demo users share a known password, so never seed a database that holds anything
  if exists (select 1 from public.guilds) or exists (select 1 from auth.users where email not like '%@demo.invalid') then
    raise exception 'seed.sql refuses to run on a non-empty database (local/demo projects only)';
  end if;

  insert into guilds (name, slug) values ('Data Guild', 'data-guild') returning id into g;

  -- DEMO PLACEHOLDER dates, pending Data Guild confirmation: the docs say only "Sept -> May", Wappu = May 1st.
  insert into seasons (guild_id, name, starts_on, ends_on, is_current)
  values (g, '2026-27', '2026-09-01', '2027-05-31', true) returning id into s;

  -- Categories in map order (display order = id). Colour/icon follow the DG map; the app renders what is stored.
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Mandatory',            '#facc15', 'cog')    returning id into c_mandatory;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Work',                 '#ea8a4c', 'bell')   returning id into c_work;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Party & Orienteering', '#16a34a', 'goblet') returning id into c_party;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Teekkari Culture',     '#1d4ed8', 'tower')  returning id into c_culture;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Guild',                '#7f1d1d', 'shield') returning id into c_guild;
  insert into categories (guild_id, season_id, name, color, icon) values (g, s, 'Other Events',         '#9ca3af', 'hex')    returning id into c_other;

  -- Tiers (ARCHITECTURE-SIMPLE "Levels")
  insert into tiers (guild_id, season_id, name, min_total) values (g, s, 'Teekkari', 40);
  insert into tiers (guild_id, season_id, name, min_total) values
    (g, s, 'Fuksi Doctor', 60), (g, s, 'Double Doctor', 80), (g, s, 'Fuksi Professor', 100);

  -- Category minimums ("Need at least"). Party & Orienteering is [0] -> no rule. tier_id null = every tier
  -- (they sum to 40; whether higher tiers need them is SDD §9 Q3).
  insert into rules (guild_id, season_id, category_id, min_points) values
    (g, s, c_mandatory, 6), (g, s, c_work, 2), (g, s, c_culture, 14), (g, s, c_guild, 12), (g, s, c_other, 6);

  -- Nodes in map order (display order = id). Photo and note are optional on every node (only the write-in
  -- pill needs its event name); a captain can still require a photo per node via tasks.requires_photo.
  -- PLACEHOLDERS until Data Guild confirms: Teekkarijäynä "1-∞p" ceiling (10, captain-reviewed), the 8 grey
  -- write-in pills' 1p ("+ my own event"), and the 4 keyholes' titles, track and 3p ("Secret 1-4").
  insert into tasks (guild_id, season_id, category_id, title, points_min, points_max, max_repeats, reviewer,
                     requires_photo, requires_note, revealed_at)
  select g, s, n.c, n.title, n.pmin, n.pmax, n.rep, n.rev, n.photo, n.note, n.rev_at from (values
    (c_mandatory, '10 ECTS Credits', 1, 1, 1, 'tutor', false, false, now()),
    (c_mandatory, 'Museum of Student Life', 1, 1, 1, 'tutor', false, false, now()),
    (c_mandatory, 'Captain''s Quarters', 1, 2, 1, 'tutor', false, false, now()),
    (c_mandatory, 'Singing Test', 1, 1, 1, 'tutor', false, false, now()),
    (c_mandatory, 'Maturity Test', 1, 1, 1, 'tutor', false, false, now()),
    (c_mandatory, 'Wappu Art', 1, 1, 1, 'tutor', false, false, now()),
    (c_work, 'Epoch', 2, 2, 1, 'tutor', false, false, now()),
    (c_work, 'Sitsit (work)', 2, 2, 1, 'tutor', false, false, now()),
    (c_work, 'Work Point', 1, 2, 2, 'tutor', false, false, now()),
    (c_party, 'Captain''s Party', 2, 2, 1, 'tutor', false, false, now()),
    (c_party, 'OtaOrienteering', 2, 2, 1, 'tutor', false, false, now()),
    (c_party, 'Stadi Orienteering', 2, 2, 1, 'tutor', false, false, now()),
    (c_party, 'Winter Day', 2, 2, 1, 'tutor', false, false, now()),
    (c_party, 'Otaniemi Festival', 2, 2, 1, 'tutor', false, false, now()),
    (c_party, 'Fuksi Party', 2, 2, 1, 'tutor', false, false, now()),
    (c_party, 'Dipoli Party', 2, 2, 1, 'tutor', false, false, now()),
    (c_culture, 'Sitsit', 1, 1, 1, 'tutor', false, false, now()),
    (c_culture, 'Getting to know AYY association', 1, 1, 1, 'tutor', false, false, now()),
    (c_culture, 'Otatarhan Ajot', 2, 2, 1, 'tutor', false, false, now()),
    (c_culture, 'Laskiaisrieha', 2, 2, 1, 'tutor', false, false, now()),
    (c_culture, 'DG x FK', 3, 3, 1, 'tutor', false, false, now()),
    (c_culture, 'Overalls Adventure', 4, 4, 1, 'tutor', false, false, now()),
    (c_culture, 'Friday the 13th', 3, 3, 1, 'tutor', false, false, now()),
    (c_culture, 'Become Tutor', 1, 1, 1, 'tutor', false, false, now()),
    (c_culture, 'Sew 100 patches', 2, 2, 1, 'tutor', false, false, now()),
    (c_culture, 'Selling Äpy/Mayday', 2, 2, 1, 'tutor', false, false, now()),
    (c_culture, 'Teekkarijäynä', 1, 10, 1, 'captain', false, false, now()),
    (c_culture, '**** event', 4, 4, 1, 'tutor', false, false, now()),
    (c_guild, 'Guild Initiation', 1, 1, 1, 'tutor', false, false, now()),
    (c_guild, 'Fuksi Championship', 2, 2, 1, 'tutor', false, false, now()),
    (c_guild, 'FuksiSitsit', 3, 3, 1, 'tutor', false, false, now()),
    (c_guild, 'Pre(xam) Party', 1, 1, 1, 'tutor', false, false, now()),
    (c_guild, 'DGCC event', 2, 2, 1, 'tutor', false, false, now()),
    (c_guild, 'Guild Uprising', 1, 1, 1, 'tutor', false, false, now()),
    (c_guild, 'Join board meeting', 1, 1, 1, 'tutor', false, false, now()),
    (c_guild, 'Join election or guild meeting', 1, 1, 1, 'tutor', false, false, now()),
    (c_guild, 'Represent DG', 1, 3, 1, 'tutor', false, false, now()),
    (c_guild, 'Otacruise', 3, 3, 1, 'tutor', false, false, now()),
    (c_guild, 'Committee Active', 1, 1, 1, 'tutor', false, false, now()),
    (c_guild, 'Nuuksio Trip', 2, 2, 1, 'tutor', false, false, now()),
    (c_guild, 'Company Excursion', 1, 1, 1, 'tutor', false, false, now()),
    (c_guild, 'Hackathon', 1, 1, 1, 'tutor', false, false, now()),
    (c_other, 'ETCO event', 1, 1, 1, 'tutor', false, false, now()),
    (c_other, 'SCI event', 2, 2, 1, 'tutor', false, false, now()),
    (c_other, 'KY event', 1, 1, 1, 'tutor', false, false, now()),
    (c_other, 'Appro', 1, 1, 1, 'tutor', false, false, now()),
    (c_other, 'Sports', 1, 1, 1, 'tutor', false, false, now()),
    (c_other, 'Guildroom cleanup', 1, 1, 1, 'tutor', false, false, now()),
    (c_other, 'Own project', 1, 3, 1, 'tutor', false, false, now()),
    (c_other, 'Tell Fuksi Major a joke or a pickup line', 2, 2, 1, 'tutor', false, false, now()),
    (c_other, '+ my own event', 1, 1, 8, 'tutor', false, true, now()),
    (c_other, 'Secret 1', 3, 3, 1, 'tutor', false, false, 'infinity'::timestamptz),
    (c_other, 'Secret 2', 3, 3, 1, 'tutor', false, false, 'infinity'::timestamptz),
    (c_other, 'Secret 3', 3, 3, 1, 'tutor', false, false, 'infinity'::timestamptz),
    (c_other, 'Secret 4', 3, 3, 1, 'tutor', false, false, 'infinity'::timestamptz)
  ) n(c, title, pmin, pmax, rep, rev, photo, note, rev_at);

  -- "What to do" texts: DRAFTS written for the demo from general teekkari culture, NOT from Data Guild.
  -- Data Guild should confirm or rewrite each one (and fill in the ones whose event is unknown to us).
  update tasks t set description = d.text
  from (values
    ('10 ECTS Credits', 'Pass your first 10 ECTS of courses. Tell your tutor once your study record shows it (never upload the transcript itself).'),
    ('Museum of Student Life', 'Visit the Museum of Student Life and see where teekkari traditions come from. A selfie there is proof enough.'),
    ('Captain''s Quarters', 'Drop by Captain''s Quarters, the guild captain''s hangout for fuksis. Introduce yourself; 2p if you stay and help out.'),
    ('Singing Test', 'Pass the singing test: sing a song from the teekkari songbook in front of the testers. Volume beats talent.'),
    ('Maturity Test', 'Pass the fuksi maturity test, a quiz on guild and teekkari culture.'),
    ('Wappu Art', 'Help make the guild''s Wappu art before May Day.'),
    ('Epoch', 'Work a shift at Epoch: setup, bar, door or cleanup.'),
    ('Sitsit (work)', 'Work at a sitsit: serve, cook or wash glasses so everyone else can sing.'),
    ('Work Point', 'Volunteer at any guild event (setup, kitchen, cleanup). 1p for a short shift, 2p for a long one. Counts twice.'),
    ('Captain''s Party', 'Come to the Captain''s Party and show your QR at the door to get checked in.'),
    ('OtaOrienteering', 'Run OtaOrienteering with your team: find the checkpoints around Otaniemi and complete their tasks.'),
    ('Stadi Orienteering', 'Run Stadi Orienteering, the checkpoint race around Helsinki, with your team.'),
    ('Winter Day', 'Join the guild''s Winter Day out in the snow.'),
    ('Otaniemi Festival', 'Take part in the Otaniemi Festival.'),
    ('Fuksi Party', 'Party at the fuksi party thrown for this year''s fuksis.'),
    ('Dipoli Party', 'Go to a party at Dipoli.'),
    ('Sitsit', 'Attend a sitsit, the academic dinner party with songs. Show your QR at the door to get checked in.'),
    ('Getting to know AYY association', 'Get to know one of the student union (AYY) associations: go to their event or visit their clubroom.'),
    ('Otatarhan Ajot', 'Take part in Otatarhan Ajot.'),
    ('Laskiaisrieha', 'Go sledging at Laskiaisrieha, the Shrove Tuesday hill party.'),
    ('DG x FK', 'Join the joint event of Data Guild and Fyysikkokilta.'),
    ('Overalls Adventure', 'Take your new teekkari overalls on their first adventure.'),
    ('Friday the 13th', 'Show up to the Friday the 13th event, if you dare.'),
    ('Become Tutor', 'Apply to become a tutor for next year''s fuksis.'),
    ('Sew 100 patches', 'Sew 100 patches onto your overalls. Your tutor will want to count them.'),
    ('Selling Äpy/Mayday', 'Sell Äpy or Mayday humour magazines around Wappu.'),
    ('Teekkarijäynä', 'Pull off a teekkarijäynä: a clever, harmless and legal prank. The captain decides the points, so make it legendary.'),
    ('**** event', 'A mysterious event. Your tutor will tell you more when the time comes.'),
    ('Guild Initiation', 'Attend the guild initiation for new members.'),
    ('Fuksi Championship', 'Compete in the fuksi championship.'),
    ('FuksiSitsit', 'Attend FuksiSitsit, the sitsit made for fuksis.'),
    ('Pre(xam) Party', 'Blow off steam at the pre-exam party.'),
    ('DGCC event', 'Go to a DGCC event.'),
    ('Guild Uprising', 'Take part in Guild Uprising.'),
    ('Join board meeting', 'Sit in on a Data Guild board meeting; members are welcome to watch.'),
    ('Join election or guild meeting', 'Attend the guild''s election meeting or another general meeting.'),
    ('Represent DG', 'Represent Data Guild at another guild''s or AYY event. 1 to 3p depending on how much you did.'),
    ('Otacruise', 'Sail on Otacruise, the student cruise.'),
    ('Committee Active', 'Be an active member of one of the guild''s committees.'),
    ('Nuuksio Trip', 'Join the trip to Nuuksio national park.'),
    ('Company Excursion', 'Join a company excursion organised by the guild.'),
    ('Hackathon', 'Take part in a hackathon.'),
    ('ETCO event', 'Attend an ETCO event.'),
    ('SCI event', 'Attend a School of Science (SCI) event.'),
    ('KY event', 'Attend an event by KY, the business students'' union.'),
    ('Appro', 'Complete an appro: collect stamps from every checkpoint.'),
    ('Sports', 'Take part in a guild or AYY sports event.'),
    ('Guildroom cleanup', 'Help clean the guild room.'),
    ('Own project', 'Do your own project for the guild or its fuksis. 1 to 3p depending on size; tell your reviewer what you made.'),
    ('Tell Fuksi Major a joke or a pickup line', 'Tell the Fuksi Major a joke or a pickup line. It has to make them laugh (or cringe).'),
    ('+ my own event', 'Went to an event that is not on the map? Write its name and your tutor decides. Counts up to 8 times.')
  ) d(title, text)
  where t.guild_id = g and t.title = d.title;

  -- events run from now for 60 days, so the demo check-in stays inside the +-2 h window on pitch day too
  insert into events (guild_id, season_id, task_id, title, starts_at, ends_at)
  select g, s, t.id, t.title, now() - interval '1 hour', now() + interval '60 days'
    from tasks t where t.guild_id = g and t.title in ('Captain''s Party', 'Sitsit');

  -- Demo roster (no tutor groups: every tutor reviews every fuksi, SDD §11)

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

  insert into members (guild_id, season_id, user_id, email, display_name, role)
  select g, s, u.id, u.email, u.display_name, u.role
  from (values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'demo.captain@demo.invalid',  'Demo Captain', 'captain'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'demo.tutor.a@demo.invalid',  'Demo Tutor A', 'tutor'),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'demo.tutor.b@demo.invalid',  'Demo Tutor B', 'tutor'),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'demo.fuksi.1@demo.invalid',  'Demo Fuksi 1', 'fuksi'),
    ('00000000-0000-4000-8000-000000000005'::uuid, 'demo.fuksi.2@demo.invalid',  'Demo Fuksi 2', 'fuksi'),
    ('00000000-0000-4000-8000-000000000006'::uuid, 'demo.fuksi.3@demo.invalid',  'Demo Fuksi 3', 'fuksi'),
    ('00000000-0000-4000-8000-000000000007'::uuid, 'demo.organizer@demo.invalid', 'Demo Organizer', 'organizer')
  ) u(id, email, display_name, role);

  insert into member_codes (member_id) select id from members where guild_id = g;
end
$seed$;
