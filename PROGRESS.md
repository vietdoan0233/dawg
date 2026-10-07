# Fuksipisteet progress

Updated: 2026-10-07

## The plan in one picture

The app is built in 5 steps called **slices**. Each slice is a small working piece (SDD §7):

| Slice | What it adds | Status |
|---|---|---|
| 1. Walking skeleton | Demo login → fuksi sees their map → submits a task → tutor approves → node lights up → projector shows it | **Done**, in `main`. Seed now holds the real Data Guild map (55 nodes); a few values still unconfirmed |
| 2. Auth & hardening | Real email login, invites, roles, more security tests | **Done**, in `main`. Needs production email + auth hooks before a pilot |
| 3. Check-in | Organizer scans a QR code at an event → point is given (works offline) | **Prototype**, in `main`. See shortcuts below |
| 4. Photos | Fuksi uploads a proof photo, tutor approves it and picks the points | **Prototype**, in `main`. No 30-day purge, the server doesn't compute the photo hash |
| 5. Import/export + polish | Captain imports the spreadsheet, exports results, reveals secret nodes | **Reveal done**, **UI polish done**. Import/export **fixes in progress** (migration 0005 adds auth, case-insensitive matching, duplicate prevention, proper CSV parsing, role restrictions, formula-safe export) |
| UI: skill tree home | The fuksi's home screen is their skill tree, on real data | **Done**, in `main` |

**Next up:** slice 5 import/export, then hardening the slice 3–4 prototypes (see the shortcut list).

Everything is merged into `main` and pushed; the merged branches are deleted. They went in without PRs.
Database tests: 7 files, 200/200 pass (last run for slice 2, 2026-10-06). Not re-run since the seed changed (2026-10-07).

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

## Slice 5: import/export fixes (in progress)

**Working on: fix import/export security and functionality (2026-10-07)**

Branch: `slice/5-import-export-fixes` (from `origin/main` commit 701d803).

Fixed issues:
1. **Authentication & authorization**: API routes now validate Bearer tokens and pass them to Edge Functions; Edge Functions verify JWT and check captain role before processing.
2. **Import confirmation end-to-end**: Mapping and confirm fields preserved through API route → Edge Function → RPC flow.
3. **Export data accuracy**: Now calls the `progress` view to return actual per-category points and calls `member_tier` for each member's tier (not hardcoded zeros).
4. **Duplicate import prevention**: New `import_history` table tracks successful imports by guild+season; repeat imports rejected with `import_already_applied` error.
5. **CSV parsing**: Proper quoted-field handling, type conversion for numeric fields, boolean parsing for flags.
6. **Case-insensitive matching**: Categories and tiers matched by `lower(name)` in import_apply; allows "TestCategory" CSV column to match "testcategory" imported data.
7. **Role restrictions**: Imported members always assigned 'fuksi' role; staff roles must use `set_role` RPC to prevent privilege escalation.
8. **Formula-safe export**: Category names and data cells in CSV escaped with leading `'` if they start with `=`, `+`, `-`, `@`, tab, or carriage return.

Added:
- Migration `0005_import_fixes.sql`: Rewrites `import_apply` with all fixes, adds `import_history` table and index.
- Test file `08_import_fixes.test.sql`: 18 pgTAP tests covering import auth, duplicate prevention, case-insensitive matching, role assignment, member/adjustment mapping, formula escaping.
- Updated `app/api/import/route.ts` and `app/api/export/route.ts`: Bearer token validation, full request body forwarding.
- Rewritten `supabase/functions/import/index.ts`: JWT verification, captain check, proper CSV parsing, organized data structure.
- Rewritten `supabase/functions/export/index.ts`: JWT verification, captain check, progress/member_tier view queries, escaped CSV output.
- Updated `tsconfig.json`: Excluded `supabase/functions` from Next.js TypeScript checking (Deno/SDK conflicts).

Build status:
- `npm run lint`: ✓ Pass
- `npm run build`: ✓ Pass
- `supabase db reset`: Requires Docker (not available in this environment; tests ready to run when Docker is available)

**Pending:**
- Lane A migration review of 0005_import_fixes.sql (role restriction, duplicate prevention, case-insensitive matching).
- Teammate agent review before merge to `main`.
- Test execution once Docker/local Supabase is available.

## What you need to do

- [x] Docker + Supabase running locally; all database tests pass.
- [x] Get the Data Guild roadmap into the seed.
- [ ] Ask Data Guild to confirm the seed placeholders (see "Still open") and the SDD §9 questions (can we use their artwork).
- [ ] Re-run `supabase db reset` + `supabase test db` after the seed change.
- [ ] Decide with the team: group submissions (submitting for several people at once). The spec has them, slice 1 turns them off. Keep off until later?
- [x] Merge everything into `main` and delete the merged branches.
- [ ] Get a teammate's review of what's in `main` (it skipped PRs).
- [ ] Set up production email + auth hooks (see "Before a real pilot" above).
- [ ] **Slice 5 import/export**: Lane A review of migration 0005, then teammate agent review, then test with Docker and merge.

## Known gaps, to fix in later slices

- Some tables (`member_codes`, `invites`, `ai_usage`) don't carry `guild_id` + `season_id`. Fix it or write the exception in the SDD.
- No test yet for two people submitting at the same moment.
- A rejected task can be resubmitted without limit. Decide if that's OK.
- Duplicate-photo check trusts the hash the phone sends; slice 4 must compute it on the server.
- The rank view gets slow at a few hundred members; fine for the demo.
