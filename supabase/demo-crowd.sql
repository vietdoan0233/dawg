-- Optional demo crowd for the pitch: 4 more tutors and 48 made-up fuksis who have done everything the
-- app does over the last 5 weeks (approved proofs, event check-ins, rejections, opening balances from the
-- old spreadsheet) plus proofs still waiting in the guild's one shared tutor queue. Demo Fuksi 1 and 2 get some history too;
-- Demo Fuksi 3 stays empty for the live "light up a node" moment.
-- Not real people: every email is @demo.invalid and none of them can log in.
-- Run after `npx supabase db reset`:  npm run demo:crowd   (running it twice does nothing)
do $crowd$
declare
  g bigint := (select id from public.guilds order by id limit 1);
  s bigint := public.current_season((select id from public.guilds order by id limit 1));
  cap bigint;
  org bigint;
  mand bigint;
  tutors bigint[];
  first_names text[] := array['Aino','Eetu','Helmi','Onni','Venla','Leevi','Ella','Elias','Aada','Väinö','Sofia','Oliver',
                              'Iida','Eino','Lilja','Niilo','Siiri','Toivo','Kerttu','Aatu','Pihla','Veeti','Enni','Lauri'];
  notes text[] := array['Here is the proof!','Photo from the event','Did this with my friends','Finally done',
                        'Was a great evening','Took a while but done','Our whole group was there','Proof attached'];
  own_events text[] := array['Board game night','Tech talk at Otaniemi','Guild sauna evening','Climbing with KY','Hackathon side event'];
  m record; t record; e record;
  act float; n int; tutor bigint; at timestamptz;
begin
  if exists (select 1 from public.members where email like 'crowd.%@demo.invalid') then
    raise notice 'demo crowd already loaded'; return;
  end if;
  perform setseed(0.42);  -- same crowd every time
  cap := (select id from public.members where guild_id = g and role = 'captain' order by id limit 1);
  org := (select id from public.members where guild_id = g and role = 'organizer' order by id limit 1);
  mand := (select id from public.categories where guild_id = g and season_id = s and name = 'Mandatory');

  -- Tutors C-F (no groups: every tutor reviews every fuksi)
  insert into public.members (guild_id, season_id, email, display_name, role)
  select g, s, format('crowd.tutor.%s@demo.invalid', lower(chr(66 + i))), 'Tutor ' || chr(66 + i), 'tutor'
    from generate_series(1, 4) i;
  tutors := (select array_agg(id order by id) from public.members where guild_id = g and season_id = s and role = 'tutor');

  insert into public.members (guild_id, season_id, email, display_name, role)
  select g, s, format('crowd.%s@demo.invalid', lpad(i::text, 2, '0')),
         first_names[1 + (i - 1) % 24] || ' ' || substr('ABEHJKLMNOPRSTUVY', 1 + (i * 7) % 17, 1) || '.', 'fuksi'
    from generate_series(1, 48) i;

  for m in select * from public.members
            where guild_id = g and role = 'fuksi'
              and (email like 'crowd.%' or display_name in ('Demo Fuksi 1', 'Demo Fuksi 2')) loop
    act := case when m.email like 'crowd.%' then 0.15 + random() * 0.85 else 0.45 end;

    for t in select * from public.tasks
              where guild_id = g and season_id = s and active and revealed_at <= now()
                and id not in (select task_id from public.events where guild_id = g) order by id loop
      -- approved, 1..3 times on repeatable nodes; keen fuksis (act > 0.5) finish every Mandatory node
      if random() < act ^ 1.5 or (act > 0.5 and t.category_id = mand) then
        n := least(t.max_repeats, 1 + floor(random() * least(t.max_repeats, 3) * act)::int);
        for i in 1..n loop
          at := now() - random() * interval '35 days' - interval '6 hours';
          tutor := tutors[1 + floor(random() * array_length(tutors, 1))::int];
          insert into public.submissions (guild_id, season_id, task_id, category_id, member_id, status, points_awarded,
                                          note, reviewed_by, reviewed_at, created_at)
          values (g, s, t.id, t.category_id, m.id, 'approved', t.points_min,
                  case when t.requires_note then own_events[1 + floor(random() * 5)::int] end,
                  case when t.reviewer = 'captain' then cap else tutor end, at + random() * interval '5 hours', at);
        end loop;
      elsif t.reviewer = 'tutor' and random() < 0.04 then            -- waiting in the tutor's queue
        insert into public.submissions (guild_id, season_id, task_id, category_id, member_id, note, created_at)
        values (g, s, t.id, t.category_id, m.id,
                case when t.requires_note then own_events[1 + floor(random() * 5)::int] else notes[1 + floor(random() * 8)::int] end,
                now() - random() * interval '2 days');
      elsif random() < 0.015 then                                    -- rejected
        at := now() - random() * interval '20 days';
        tutor := tutors[1 + floor(random() * array_length(tutors, 1))::int];
        insert into public.submissions (guild_id, season_id, task_id, category_id, member_id, status, note,
                                        reviewed_by, reviewed_at, created_at)
        values (g, s, t.id, t.category_id, m.id, 'rejected', 'Blurry photo, sorry', tutor, at + interval '3 hours', at);
      end if;
    end loop;

    for e in select ev.*, tk.category_id, tk.points_min from public.events ev join public.tasks tk on tk.id = ev.task_id
              where ev.guild_id = g loop                              -- QR check-ins at tonight's events
      if random() < act then
        at := greatest(e.starts_at, now() - random() * interval '50 minutes');
        insert into public.submissions (guild_id, season_id, task_id, category_id, member_id, event_id, status,
                                        points_awarded, reviewed_by, reviewed_at, created_at)
        values (g, s, e.task_id, e.category_id, m.id, e.id, 'approved', e.points_min, org, at, at);
      end if;
    end loop;

    if m.email like 'crowd.%' and random() < 0.3 then                 -- points from before the app
      insert into public.adjustments (guild_id, season_id, member_id, category_id, points, reason, created_by)
      select g, s, m.id, id, 1 + floor(random() * 3)::int, 'Opening balance (imported from the old spreadsheet)', cap
        from public.categories where guild_id = g and season_id = s and name = 'Other Events';
    end if;
  end loop;
end
$crowd$;

-- top 10 by the leaderboard() maths: total = progress, week = approved submissions of the last 7 days
select m.display_name as name, coalesce(sum(p.points), 0) as total,
       (select coalesce(sum(x.points_awarded), 0) from public.submissions x
         where x.member_id = m.id and x.status = 'approved'
           and coalesce(x.reviewed_at, x.created_at) >= now() - interval '7 days') as week
  from public.members m left join public.progress p on p.member_id = m.id
 where m.role = 'fuksi' and m.guild_id = (select id from public.guilds order by id limit 1)
 group by m.id, m.display_name order by total desc, name limit 10;
