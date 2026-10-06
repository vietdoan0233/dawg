# Fuksipisteet progress

Updated: 2026-10-06

## The plan in one picture

The app is built in 5 steps called **slices**. Each slice is a small working piece (SDD §7):

| Slice | What it adds | Status |
|---|---|---|
| 1. Walking skeleton | Demo login → fuksi sees their map → submits a task → tutor approves → node lights up → projector shows it | **Built, reviewed, waiting on a real database test** |
| 2. Auth & hardening | Real email login, invites, roles, more security tests | Not started |
| 3. Check-in | Organizer scans a QR code at an event → point is given (works offline) | Not started |
| 4. Photos | Fuksi uploads a proof photo, tutor approves it and picks the points | Not started |
| 5. Import/export + polish | Captain imports the spreadsheet, exports results, reveals secret nodes | Not started |

## Where we are (slice 1)

Branch `slice/1-walking-skeleton`.

**Done**
- App pages: fuksi map, tutor/captain review queue, projector board with leaderboard.
- Database: all tables, security rules, and the one function allowed to give points (`award_task`).
- Supports several guilds with different rules (rules are data, not code).
- 5 database test files, written but not yet run for real (see below).
- Reviewed by 3 agents (database, security, code) on 2026-10-06. No critical issues. Fixed:
  - switching demo users showed the previous user's map or queue
  - deleting a task would have erased the points people earned from it
  - missing index for the tutor check
  - an old login lookup could overwrite a newer one
  - demo login was on by default in `.env.example`

**Not done yet: needed to finish slice 1**
1. **Run the database tests for real.** Needs Docker + Supabase CLI: `supabase start`, `supabase db reset`, `supabase test db`. Nobody on the team has run this yet.
2. **Get the real Data Guild roadmap** (the image or a list of nodes with category, points, repeats, who reviews, photo yes/no, secret yes/no). The seed only has one placeholder task for now.
3. **Open a PR to `main`** and get a teammate's review, then merge.

## What you need to do

- [ ] Install Docker Desktop + Supabase CLI, then run the 3 commands above. Report anything that fails.
- [ ] Ask Data Guild for the roadmap data and the open questions in SDD §9 (mandatory nodes, is 40p required, secret node rules, jäynä points, can we use their artwork).
- [ ] Decide two small things with the team:
  - Projector: show one member's map (current) or the whole guild?
  - Group submissions (submitting for several people at once): the spec has them, slice 1 turns them off. Keep off until later?
- [ ] After that: open the PR, merge, start slice 2.

## Known gaps, to fix in later slices

- Some tables (`member_codes`, `invites`, `ai_usage`) don't carry `guild_id` + `season_id`. Fix it or write the exception in the SDD.
- `supabase/config.toml` allows open email+password sign-up. Lock it down in slice 2.
- No test yet for two people submitting at the same moment.
- A rejected task can be resubmitted without limit. Decide if that's OK.
- Duplicate-photo check trusts the hash the phone sends; slice 4 must compute it on the server.
- The rank view gets slow at a few hundred members; fine for the demo.
