# Fuksipisteet progress

Updated: 2026-10-08

## The plan in one picture

The app is built in 5 steps called **slices**. Each slice is a small working piece (SDD §7):

| Slice | What it adds | Status |
|---|---|---|
| 1. Walking skeleton | Demo login → fuksi sees their map → submits a task → tutor approves → node lights up → projector shows it | **Done**, in `main`. Seed now holds the real Data Guild map (55 nodes); a few values still unconfirmed |
| 2. Auth & hardening | Real email login, invites, roles, more security tests | **Done**, in `main`. Needs production email + auth hooks before a pilot |
| 3. Check-in | Organizer scans a QR code at an event → point is given (works offline) | **Prototype**, in `main`. See shortcuts below |
| 4. Photos | Fuksi uploads a proof photo, tutor approves it and picks the points | **Prototype**, in `main`. No 30-day purge, the server doesn't compute the photo hash |
| 5. Import/export + polish | Captain imports the spreadsheet, exports results, reveals secret nodes | **Done** on branch `slice/5-import-export-finish`: roster import (AI column mapping, headers only), results export, reveal, UI polish |
| UI: skill tree home | The fuksi's home screen is their skill tree, on real data | **Done**, in `main` |

**Next up:** hardening the slice 3–4 prototypes (see the shortcut list).

Everything is merged into `main` and pushed; the merged branches are deleted. They went in without PRs.
Database tests: 8 files, 214/214 pass (`supabase db reset` + `supabase test db`, 2026-10-08).

## Slice 1: walking skeleton (merged)

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

**Still open**
1. Data Guild to confirm the seed's placeholders: season dates, the 8 write-in "+ my own event" points (1p), the Teekkarijäynä ceiling (10p), which nodes need a photo vs a check-in, and what the 4 secret keyholes are (`Secret 1-4`, 3p).
2. A teammate's review of what is in `main` is still owed (AGENTS.md).

## Slices 3–5 prototype (merged, built 2026-10-06)

The whole 3-minute demo from SDD §7 works end to end. It was clicked through in a real browser:
fuksi shows their QR → organizer/tutor checks them in and the node lights up → fuksi uploads a photo → tutor
sees the photo and approves 2p → the level ladder ticks → captain reveals the 🔒 keyhole and it unlocks on the projector.

What was added:
- Database (`0002_demo_flow.sql`): `checkin`, `my_code`, `update_task` (reveal only), and a private photo bucket.
  22 new database tests (158 total, all pass).
- Screens: "Show my QR" for fuksis, a check-in scanner for staff (camera on Chrome/Android, typing the code elsewhere,
  and scans wait on the phone when offline), photo upload, photos and "Approve all" in the review queue, and a reveal panel for the captain.

Known prototype shortcuts (fix before a real pilot):
- Photos are never deleted yet (needs the 30-day purge function).
- Photo duplicate check trusts the hash the phone sends.
- The QR camera only works where the browser has a built-in QR reader (Chrome on Android). Elsewhere you type the code.
- Captain can only *reveal* a node, not edit it yet.
- No limit on how many photos one person uploads (needs the purge job or a quota).
- ~~QR codes never change~~: fixed in slice 2 (`rotate_my_code`, "Make a new QR code").
- Any tutor can check in any fuksi in the guild, not only their own group. Probably fine; confirm with the team.
- The check-in time the phone reports is checked but not saved, so a late check-in can't be audited yet.

## Slice 2: real login (merged, built 2026-10-06)

Two modes, one codebase:
- `npm run dev` = **real app**: log in with your @aalto.fi email + a 6-digit code.
- `npm run demo` = **pitch demo**: the "Choose your character" screen with demo users.

What works (tested in a real browser):
- Log in with a 6-digit email code. Non-@aalto.fi emails are refused, both in the app and by the server.
- Invite links (`/join/<code>`). Joining always makes you a **fuksi**. If the captain pre-listed your email, you get that row (e.g. captain).
- The captain makes or revokes invite links and sets anyone's role and tutor group. Nobody can change their own role.
- "Make a new QR code" for a lost phone. The old code stops working.
- Onboarding a new guild: a platform admin runs `select bootstrap_guild('Guild name', 'slug', 'captain@aalto.fi');`
  in the Supabase SQL editor and sends the returned invite link (`/join/<code>`) to the captain.
- 37 new database tests in `07_auth` (200 total, all pass).

Locally, login emails go to the test inbox at http://127.0.0.1:54324 (nothing is really sent).

**Before a real pilot (needs you):**
- An email provider (e.g. Resend or Postmark) set up as SMTP in the Supabase dashboard, plus raised email rate limits.
- In the real Supabase project, set up the two auth hooks (Before User Created, Custom Access Token), the code email
  template (`supabase/templates/otp.html`) and a 10-minute code expiry. Run `supabase config push` or set them in the dashboard;
  `config.toml` only covers the local copy.
- Password login is already refused for every real account (a token hook, see `0003_auth.sql`). It closes a real
  hijack we reproduced: someone password-signs-up the captain's email before the captain's first login.
- Tutor groups can only be created by the import (slice 5) for now.

## UI: home screens and polish (merged 2026-10-07)

- **Fuksi home = their skill tree**, on real data (`roadmap()`), no schema change. The hub shows points and the
  ring to the next level; track chips fly to a branch; tap a node for details, double-tap to submit proof.
  Approvals draw on as neon lines with a chime, reveals unlock keyholes, a new level shows a level-up card.
  Dock: My QR and Ranks. `/tree` now just redirects to `/`. Check: `node scripts/check-news.mjs`.
- **Staff home**: one tab per tool, shown by role (Review, Check-in, Ranks, Secrets, People) plus a Projector link.
- **Smooth tree**: pan/zoom writes the transform straight to the page once per frame (no React re-render per move),
  the 5 s refresh no longer snaps the view back, and the dot grid sits on its own layer. Measured in Chrome:
  ~43 ms → ~17 ms per frame (60 fps).
- Buttons lift on hover and ripple on press; each screen and staff tab slides in. All off under "reduce motion".
- Who can do what, per role: `docs/fuksipisteet/USER-WORKFLOWS.md`.
- **Phone layout** (2026-10-07): checked at 375 px (fuksi tree, node card, QR sheet, every staff tab, projector,
  welcome). Fixed: the top bar was 650 px wide and stretched the whole screen (tree off-centre, logout and zoom
  buttons off-screen); staff tabs scrolled sideways (Secrets/People/Projector hidden) and now fit as icon + label;
  welcome cards show two per row. Desktop unchanged. CSS only (`app/globals.css`).

## Slice 5: import/export (built 2026-10-08)

The first push (0004/0005, two edge functions, two Next API routes) did not work end to end: the browser sent no
token, the functions never called `Deno.serve`, `import_apply` ran as the service role (so always `forbidden`),
field names and NOT NULL defaults mismatched, and `import_history` had no RLS (any user could read every guild's rows).
Its pgTAP file failed 17/18. Rebuilt smaller:

- **Import** (captain, Import/Export tab): pick a CSV (comma or Finnish-Excel `;`). The browser parses it and guesses
  each column (email / name / tutor group / points per category, Finnish headers too). Only the *unknown column
  headers* go to the `map-columns` edge function (Claude Haiku, 20 calls/day per user via `ai_usage`); never a cell
  value. The captain checks every column in a dropdown, then `import_apply` runs with the captain's own login.
  Without `ANTHROPIC_API_KEY` the AI step is skipped and the captain sets the unknown columns by hand.
- **Re-import is safe**: existing people, categories, tasks, tiers, rules and opening balances are skipped, not doubled.
  Roster rows always join as fuksi; a `role` column is ignored (staff roles stay under People). Emails must be @aalto.fi.
- **Export**: built in the browser from what the captain can already read: name, role, tutor group, points per
  category, total, tier. Text starting with `= + - @` gets a `'` (formula injection); numbers stay numbers.
- Migration `0006_import_apply_fix.sql`: drops `import_history` and the unused `csv_escape_formula`, rewrites
  `import_apply`. No service-role key outside `supabase/functions/*`; the Next API routes are gone.
- Tests: `08_import.test.sql` (14), `node scripts/check-csv.mjs`. Clicked through in Chrome as Demo Captain.

**Before a pilot:** `supabase secrets set ANTHROPIC_API_KEY=...` and `supabase functions deploy map-columns`.
The AI call itself was not exercised locally (no key here); the no-key fallback was.

## What you need to do

- [x] Docker + Supabase running locally; all database tests pass.
- [x] Get the Data Guild roadmap into the seed.
- [ ] Ask Data Guild to confirm the seed placeholders (see "Still open") and the SDD §9 questions (can we use their artwork).
- [ ] Re-run `supabase db reset` + `supabase test db` after the seed change.
- [ ] Decide with the team: group submissions (submitting for several people at once). The spec has them, slice 1 turns them off. Keep off until later?
- [x] Merge everything into `main` and delete the merged branches.
- [ ] Get a teammate's review of what's in `main` (it skipped PRs).
- [ ] Set up production email + auth hooks (see "Before a real pilot" above).
- [ ] **Slice 5**: teammate review of `slice/5-import-export-finish`, then merge. Set `ANTHROPIC_API_KEY` as a function secret.

## Known gaps, to fix in later slices

- Some tables (`member_codes`, `invites`, `ai_usage`) don't carry `guild_id` + `season_id`. Fix it or write the exception in the SDD.
- No test yet for two people submitting at the same moment.
- A rejected task can be resubmitted without limit. Decide if that's OK.
- Duplicate-photo check trusts the hash the phone sends; slice 4 must compute it on the server.
- The rank view gets slow at a few hundred members; fine for the demo.
