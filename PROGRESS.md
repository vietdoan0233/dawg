# Fuksipisteet progress

Updated: 2026-10-06

## The plan in one picture

The app is built in 5 steps called **slices**. Each slice is a small working piece (SDD §7):

| Slice | What it adds | Status |
|---|---|---|
| 1. Walking skeleton | Demo login → fuksi sees their map → submits a task → tutor approves → node lights up → projector shows it | **Done.** Database tests pass. Waiting on PR + review |
| 2. Auth & hardening | Real email login, invites, roles, more security tests | **Built** (branch `slice/2-auth`) |
| 3. Check-in | Organizer scans a QR code at an event → point is given (works offline) | **Prototype built** |
| 4. Photos | Fuksi uploads a proof photo, tutor approves it and picks the points | **Prototype built** |
| 5. Import/export + polish | Captain imports the spreadsheet, exports results, reveals secret nodes | **Reveal built**; import/export not started |

## Where we are (slice 1)

Branch `slice/1-walking-skeleton`.

**Done**
- App pages: fuksi map, tutor/captain review queue, projector board with leaderboard.
- Database: all tables, security rules, and the one function allowed to give points (`award_task`).
- Supports several guilds with different rules (rules are data, not code).
- 5 database test files. They run and pass (`supabase db reset` + `supabase test db`, 2026-10-06).
- Reviewed by 3 agents (database, security, code) on 2026-10-06. No critical issues. Fixed:
  - switching demo users showed the previous user's map or queue
  - deleting a task would have erased the points people earned from it
  - missing index for the tutor check
  - an old login lookup could overwrite a newer one
  - demo login was on by default in `.env.example`

**Not done yet: needed to finish slice 1**
1. **Get the real Data Guild roadmap** (the image or a list of nodes with category, points, repeats, who reviews, photo yes/no, secret yes/no). The seed only has placeholder nodes for now.
2. **Open a PR to `main`** and get a teammate's review, then merge.

## Prototype (branch `slice/3-5-prototype`, built 2026-10-06)

The whole 3-minute demo from SDD §7 works end to end. It was clicked through in a real browser:
fuksi shows their QR → organizer/tutor checks them in and the node lights up → fuksi uploads a photo → tutor
sees the photo and approves 2p → the level ladder ticks → captain reveals the 🔒 keyhole and it unlocks on the projector.

What was added:
- Database (`0002_demo_flow.sql`): `checkin`, `my_code`, `update_task` (reveal only), and a private photo bucket.
  22 new database tests (158 total, all pass).
- Screens: "Show my QR" for fuksis, a check-in scanner for staff (camera on Chrome/Android, typing the code elsewhere,
  and scans wait on the phone when offline), photo upload, photos and "Approve all" in the review queue, and a reveal panel for the captain.
- Demo data: a demo organizer plus 6 **placeholder** nodes (not the real Data Guild map) so the demo has something to show.

Known prototype shortcuts (fix before a real pilot):
- The UI is rough. Polish comes later.
- Photos are never deleted yet (needs the 30-day purge function).
- Photo duplicate check trusts the hash the phone sends.
- The QR camera only works where the browser has a built-in QR reader (Chrome on Android). Elsewhere you type the code.
- Captain can only *reveal* a node, not edit it yet.
- No limit on how many photos one person uploads (needs the purge job or a quota).
- QR codes never change. A leaked code works all season (needs a "new code" button, `rotate_my_code`).
- Any tutor can check in any fuksi in the guild, not only their own group. Probably fine; confirm with the team.
- The check-in time the phone reports is checked but not saved, so a late check-in can't be audited yet.

## Slice 2: real login (branch `slice/2-auth`, built 2026-10-06)

Two modes, one codebase:
- `npm run dev` = **real app**: log in with your @aalto.fi email + a 6-digit code.
- `npm run demo` = **pitch demo**: the "Log in as…" switcher with demo users.

What works (tested in a real browser):
- Log in with a 6-digit email code. Non-@aalto.fi emails are refused, both in the app and by the server.
- Invite links (`/join/<code>`). Joining always makes you a **fuksi**. If the captain pre-listed your email, you get that row (e.g. captain).
- The captain makes or revokes invite links and sets anyone's role and tutor group. Nobody can change their own role.
- "Make a new QR code" for a lost phone. The old code stops working.
- Onboarding a new guild: a platform admin runs `select bootstrap_guild('Guild name', 'slug', 'captain@aalto.fi');`
  in the Supabase SQL editor and sends the returned invite link (`/join/<code>`) to the captain.
- 28 new database tests (191 total, all pass).

Locally, login emails go to the test inbox at http://127.0.0.1:54324 (nothing is really sent).

**Before a real pilot (needs you):**
- An email provider (e.g. Resend or Postmark) set up as SMTP in the Supabase dashboard, plus raised email rate limits.
- In the real Supabase project, set up the two auth hooks (Before User Created, Custom Access Token), the code email
  template (`supabase/templates/otp.html`) and a 10-minute code expiry. Run `supabase config push` or set them in the dashboard;
  `config.toml` only covers the local copy.
- Password login is already refused for every real account (a token hook, see `0003_auth.sql`). It closes a real
  hijack we reproduced: someone password-signs-up the captain's email before the captain's first login.
- Tutor groups can only be created by the import (slice 5) for now.

## What you need to do

- [x] Docker + Supabase running locally; all database tests pass.
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
