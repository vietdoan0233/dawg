# Fuksipisteet — SDD v2.1 (consensus: all 5 debaters SATISFIED, round 3)

Product: Aalto guilds track fuksi points (tasks + events → points → teekkari cap at Wappu). Today: Google Forms + Sheets + Telegram photos + manual counting.
Team: 3 (2 Claude Code, 1 Codex). Hackathon demo, then pilot with 1 guild (~150 fuksis, ~20 tutors) Oct–May.

## 0. Architecture rules (ADR summary)
- **ADR-1 Where logic lives.** Clients never write tables. **Every write is a `security definer` Postgres RPC** (role check + invariants + transaction inside). Clients get **explicit SELECT grants only**; RLS filters rows. Edge Functions only for secrets/external calls (AI import, photo purge). Next.js = UI + reads; never holds the service-role key.
- **ADR-2 Check-in direction.** Organizer device scans the **fuksi's personal QR** (random 128-bit code) and queues offline. No rotating event secret.
- **ADR-3 Seasons.** `seasons` + `season_id` on every domain row; composite FKs include `season_id` so nothing links across seasons. Exactly one `is_current` season per guild; helpers resolve the caller's member row **in the current season only**.
- **ADR-4 Points are snapshotted.** `points_awarded` stored at approval/check-in. Event points come **only** from check-ins.
- **ADR-5 Categories are rows, not text.** `categories` table; every category reference is a composite FK. Import maps to existing categories or creates them in the preview.

## 1. Roles
`fuksi` · `tutor` (approves own tutor group; can scan) · `organizer` (can scan) · `captain` (everything in guild). Invites only create `fuksi`; staff roles only via captain `set_role`.

## 2. Stack
| Area | Choice |
|---|---|
| App | Plain responsive Next.js (App Router) on Vercel. No PWA / service worker. |
| Photo capture | `<input type="file" accept="image/*" capture="environment">` → canvas re-encode JPEG ≤1600px (strips EXIF) → `crypto.subtle` SHA-256 |
| QR | Fuksi QR drawn on-device by `qrcode` from a **localStorage-cached** code (works with no signal). Organizer scans with **`jsqr` only** (one code path; iOS lacks BarcodeDetector). |
| Backend | Supabase, **EU region**: Postgres, Auth, RLS, Storage, pg_cron, 2 Edge Functions |
| Auth | **Email 6-digit OTP**, long sessions, `@aalto.fi` enforced by Before-User-Created auth hook. **Custom SMTP (Resend or Postmark)** + raised auth email rate limits (built-in sender throttles to a few/hour). Deliverability to Aalto Outlook tested before pilot. |
| Demo login | Demo Supabase project only: seeded users + "log in as" switcher (password sign-in), shown only when `NEXT_PUBLIC_DEMO=1`. Pilot project has password sign-in **disabled**, so the switcher cannot work there even if shipped. |
| AI | Claude Haiku 4.5 in Edge Function `import` only: maps spreadsheet **columns** → schema. Preview shows the proposed mapping (visible AI step). |
| Leaderboard | Projector page polls `leaderboard()` every 5 s; animated score changes. |
| Export | Member × category matrix CSV + qualified list |

Cut: pHash, AI photo suggestion, Q&A, PWA, `group_submissions`, Realtime, rotating event QR, Telegram login, BarcodeDetector branch.

## 3. Schema (migration 0001 — frozen day 0)
```sql
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------- privileges first (ADR-1) ----------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
-- explicit grants at the end of the file

create table guilds (id bigint generated always as identity primary key, name text not null, slug text not null unique, created_at timestamptz not null default now());

create table seasons (
  id bigint generated always as identity primary key,
  guild_id bigint not null references guilds on delete cascade,
  name text not null, starts_on date not null, ends_on date not null check (ends_on > starts_on),
  is_current boolean not null default false,
  unique (guild_id, id));
create unique index on seasons (guild_id) where is_current;

-- every season-scoped table: unique (guild_id, season_id, id) + FK (guild_id, season_id) → seasons
create table categories (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, name text not null,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  unique (guild_id, season_id, name), unique (guild_id, season_id, id));

create table tutor_groups (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, name text not null,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  unique (guild_id, season_id, id));

create table members (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  user_id uuid references auth.users on delete cascade,      -- null = imported roster row not yet claimed
  email citext not null,
  display_name text not null,
  role text not null default 'fuksi' check (role in ('fuksi','tutor','organizer','captain')),
  tutor_group_id bigint,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, tutor_group_id) references tutor_groups (guild_id, season_id, id) on delete set null (tutor_group_id),
  unique (guild_id, season_id, email),
  unique (guild_id, season_id, user_id),
  unique (guild_id, season_id, id));
create index on members (user_id, guild_id, season_id);

create table member_codes (                                     -- no grants: only via RPCs
  member_id bigint primary key references members on delete cascade,
  code text not null unique default encode(gen_random_bytes(16), 'hex'));

create table tasks (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, category_id bigint not null,
  title text not null, description text,
  points int not null check (points between 0 and 100),
  max_repeats int not null default 1 check (max_repeats between 1 and 50),
  requires_photo boolean not null default true, active boolean not null default true,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  unique (guild_id, season_id, id));

create table rules (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  category_id bigint,                                           -- null = total threshold
  min_points int not null check (min_points > 0),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  unique nulls not distinct (guild_id, season_id, category_id));

create table events (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, category_id bigint not null,
  title text not null,
  points int not null check (points between 0 and 100),
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  unique (guild_id, season_id, id));

create table submissions (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  task_id bigint not null, member_id bigint not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  points_awarded int check (points_awarded >= 0),
  photo_path text, photo_sha256 text,                           -- group rows share photo_path
  note text check (length(note) <= 500),
  reviewed_by bigint, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (guild_id, season_id, task_id)   references tasks   (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, member_id) references members (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, reviewed_by) references members (guild_id, season_id, id) on delete set null (reviewed_by),
  check ((status = 'approved') = (points_awarded is not null)));
create index on submissions (guild_id, status, member_id);
create index on submissions (member_id) where status = 'approved';
create index on submissions (guild_id, photo_sha256);
create index on submissions (photo_path);                       -- storage policy join

create table checkins (
  guild_id bigint not null, season_id bigint not null,
  event_id bigint not null, member_id bigint not null,
  scanned_at timestamptz not null, synced_at timestamptz not null default now(),
  scanned_by bigint, points_awarded int not null,
  primary key (event_id, member_id),
  foreign key (guild_id, season_id, event_id)  references events  (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, member_id) references members (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, scanned_by) references members (guild_id, season_id, id) on delete set null (scanned_by));
create index on checkins (member_id);

create table adjustments (                                      -- opening balances + captain corrections
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  member_id bigint not null, category_id bigint not null,
  points int not null, reason text not null,
  created_by bigint, created_at timestamptz not null default now(),
  foreign key (guild_id, season_id, member_id)   references members    (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  foreign key (guild_id, season_id, created_by)  references members    (guild_id, season_id, id) on delete set null (created_by));
create index on adjustments (member_id);

create table invites (
  code text primary key default encode(gen_random_bytes(9), 'hex'),
  guild_id bigint not null, season_id bigint not null,
  max_uses int not null default 300, used_count int not null default 0,
  expires_at timestamptz not null, revoked_at timestamptz, created_by bigint,
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade);

create table ai_usage (user_id uuid not null references auth.users on delete cascade, day date not null, calls int not null default 0, primary key (user_id, day));

-- ---------- RLS on, explicit grants ----------
-- alter table … enable row level security;  for EVERY table above
grant select on guilds, seasons, categories, tutor_groups, tasks, rules, events, submissions, checkins, adjustments to authenticated;
grant select (id, guild_id, season_id, display_name, role, tutor_group_id) on members to authenticated;  -- no email, no user_id
-- invites: no grant (captain reads via RPC). member_codes, ai_usage: no grant.
-- grant execute on function <each RPC in §4> to authenticated;
```
Views (`with (security_invoker = true)`, granted SELECT to authenticated):
- `progress(member_id, category_id, points)` = Σ approved `submissions.points_awarded` (task category) + Σ `checkins.points_awarded` (event category) + Σ `adjustments.points`.
- `qualified(member_id)` = members meeting every `rules` row of their season.

RLS helpers (`language sql stable security definer set search_path = ''`, called as `(select fn(...))`), all resolved against the guild's **current season**:
`current_season(g)`, `is_member(g)`, `has_role(g, roles text[])`, `my_member_id(g)`, `is_tutor_of(member_id)`.

## 4. RPCs (all `security definer`, `set search_path = ''`, role check first, generic error codes, `grant execute … to authenticated` individually)
| RPC | Who | Does |
|---|---|---|
| `join_guild(code)` | authed | Validates invite (row lock, not revoked/expired, `used_count < max_uses`). Claims imported roster row (same email, current season) else creates `fuksi`. |
| `submit_task(task_id, note, photo_path, photo_sha256, with_member_ids bigint[] default '{}')` | fuksi | Task + all members in current season; extras in caller's tutor group. Per member `pg_advisory_xact_lock(hashtextextended(member_id \|\| ':' \|\| task_id, 0))`, pending+approved < `max_repeats`, insert `pending`. Photo path must be under caller's prefix. |
| `review_submissions(ids bigint[], approve bool)` | tutor of each member / captain | Same lock + re-check `max_repeats`; sets `points_awarded`, `reviewed_by`, `reviewed_at`. |
| `checkin(event_id, member_code, scanned_at)` | organizer/tutor/captain | Code resolves to a member in the event's guild+season; `scanned_at` within event window ±2 h, `<= now()+5 min`, `now()-scanned_at < 24 h`; `on conflict do nothing`. Returns `{status: ok\|duplicate\|unknown\|outside_window, display_name}`. |
| `event_roster(event_id)` | organizer/tutor/captain | `[{code_sha256, display_name}]` for the event's season — cached on the organizer device so offline scans still show a name. |
| `my_code()` / `rotate_my_code()` | member | Own code only. |
| `set_role(member_id, role, tutor_group_id)` | captain | Only way to change role/group. |
| `set_current_season(season_id)` | captain | Only way to flip `seasons.is_current` (clears the old one in the same transaction). |
| `add_adjustment(member_id, category_id, points, reason)` | captain | Corrections + manual check-in fallback. |
| `import_apply(kind, rows jsonb)` | captain | Inserts categories / tasks / roster / opening balances after preview; category names trimmed, matched case-insensitively to existing; points clamped. |
| `leaderboard(guild_id)` | member | Tutor-group totals only. |
| `captain_roster(guild_id)` | captain | Members incl. email + progress matrix for export. |
| `create_invite(...)` / `revoke_invite(code)` / `list_invites()` | captain | — |

## 5. Security & privacy
**Privileges:** default grants revoked (tables + functions, incl. default privileges); explicit column-listed SELECT; zero INSERT/UPDATE/DELETE grants to clients; EXECUTE only on listed RPCs.
**RLS matrix** (SELECT only; each row has a pgTAP test):
| Table | fuksi | tutor | captain |
|---|---|---|---|
| guilds, seasons, categories, tutor_groups, tasks, rules, events | ✓ own guild | ✓ | ✓ |
| members (no `email` column granted) | ✓ own guild, current season | ✓ | ✓ (+email via RPC) |
| submissions, checkins, adjustments | own rows | own + own group | whole guild (current season) |
| invites, member_codes, ai_usage | — | — | — (RPC only) |

**pgTAP asserts:** `relrowsecurity` on every public table; no INSERT/UPDATE/DELETE privilege for `anon`/`authenticated`; `members.email` not selectable by `authenticated`; last season's captain row cannot read current season; each matrix cell.
**Storage** `proofs`: private, `file_size_limit` 5 MB, `allowed_mime_types = {image/jpeg}`. INSERT only to `{guild_id}/{my_member_id}/{uuid}.jpg`. SELECT only if a submission with that `photo_path` exists and caller is its member, that member's tutor, or captain. No client DELETE. Signed URLs ≤ 5 min.
**Retention:** `purge-photos` (pg_cron daily) deletes via Storage API every photo 30 days after upload regardless of status. Season personal data deleted 90 days after `ends_on`; captain keeps exported cap list.
**GDPR:** privacy notice (controller = guild; legitimate interest; processors Supabase EU, Vercel, email provider). Anthropic receives only column headers + masked sample shapes. **Erasure requests:** documented manual process — captain runs `delete member` (cascades) + photo delete, logged.
**AI hardening:** zod-validated mapping; unknown fields dropped; points clamped; captain preview; `ai_usage` 20 calls/user/day; no tools.
**Other:** service-role key only in Edge Functions; separate demo and pilot Supabase projects; nothing secret in `NEXT_PUBLIC_*`.

## 6. Key flows
1. **Onboard:** captain imports Sheet (AI mapping preview) → categories + roster + catalog + opening balances → invite link in guild Telegram → fuksi enters aalto.fi email → 6-digit code → `join_guild` claims roster row → QR code cached locally. Done at first tutor meeting.
2. **Submit:** searchable task list → optional photo (EXIF stripped) → optional "whole group did it" → `submit_task`.
3. **Approve:** tutor queue grouped by `photo_path`; swipe or "approve all"; duplicate badge if same `photo_sha256` under a different `photo_path`.
4. **Check-in:** organizer opens `/organizer/[event]` **before** the venue → page caches `event_roster()` → screen wake lock + "don't reload — queue is saved" banner + `beforeunload` warning. Each scan: name shown large from the cached roster (never silent auto-confirm) → pushed to localStorage queue → `checkin` RPC, retried on `online` + every 10 s. `ok`/`duplicate` clear from queue; `unknown`/`outside_window` are **shown to the organizer and stop retrying** (never dropped silently). Captain `add_adjustment` fallback.
5. **Progress:** fuksi home = total vs threshold + per-category gaps + own QR (offline-capable). Projector `/board/[guild]` polls `leaderboard()` every 5 s with animated changes.
6. **Export:** member × category CSV + qualified list.

## 7. Build slices
1. **Walking skeleton (day 1):** migration 0001 (incl. privileges) + RPC stubs + **demo seed users + "log in as" switcher** → submit (no photo) → approve → progress bar → projector leaderboard; deployed to the demo project. Write the 3-min demo script; rehearse after every slice.
2. **Auth & hardening:** OTP + custom SMTP + rate limits + auth hook + invites + `set_role` + pgTAP privilege/RLS suite.
3. **Check-in:** `my_code` + offline QR, `/organizer/[event]` (jsqr, roster cache, queue, wake lock), `checkin` RPC. **Tests:** queue survives reload and replays; replay is idempotent; `unknown`/`outside_window` surface.
4. **Photos:** capture + EXIF strip + SHA-256 + bucket limits/policies + `purge-photos` + duplicate badge + approve-all.
5. **Import/export + polish:** `import` + `import_apply` (category matching) + CSV export + loud-room UI.
Fallback if late: slices 1–3 + export alone are a complete pitch.

## 8. Lanes & contracts
- **Day-0 contract (first 3 h, all three):** migration 0001, RPC signatures (§4), `supabase gen types` committed. After that A reviews every migration PR; nobody edits 0001.
- **A (Claude Code):** slices 1–2 — schema, privileges, RPC bodies, RLS, pgTAP.
- **B (Claude Code):** fuksi + tutor UI, slice 4, slice 5 export/polish.
- **C (Codex):** slice 3 (`/organizer/*`, `checkin` + `event_roster` bodies, queue tests) + `supabase/functions/*` (`import`, `purge-photos`). Contract tests against RPCs.
- **CI:** `supabase db reset` + pgTAP + `gen types` diff check on every PR.

## 9. Out of scope (revisit after pilot)
Telegram login/bot pings, AI photo suggestion, pHash, Q&A, Realtime, PWA, season rollover UI.

---
## Appendix A: Round-2 resolution log
| Debater | Item | Resolution |
|---|---|---|
| Architect | R1 free-text categories | **Accepted** → ADR-5 `categories` table + composite FKs; import matches case-insensitively |
| Architect | organizer reload in dead zone | **Accepted** → banner, `beforeunload`, wake lock, reload-replay test |
| Security | R1 column revoke ineffective | **Accepted** → revoke all (incl. default privileges + functions), explicit column grants, pgTAP asserts |
| Security | nice: queue errors, bucket limits, erasure | **Accepted** all three |
| Database | R1 cross-season leakage | **Accepted** → `season_id` on submissions/checkins/adjustments, 3-column composite FKs, tutor_group FK incl. season |
| Database | R2 helpers not season-scoped | **Accepted** → `seasons.is_current` + partial unique index; helpers resolve current season (over Architect's "purge covers it": purge failure would leak) |
| Database | R3 multiple null rules | **Accepted** → `unique nulls not distinct` |
| Database | R4 base64 invites | **Accepted** → hex (also raised by Minimalist) |
| Database | advisory lock int4 | **Accepted** → `hashtextextended(...)` |
| Database | photo_path index, category normalisation | **Accepted** (normalisation superseded by ADR-5) |
| Product | R1 email throttling | **Accepted** → custom SMTP + rate limits + deliverability test |
| Product | R2 fuksi QR offline | **Accepted** → localStorage-cached code, on-device QR |
| Product | R3 skeleton has no login | **Accepted** → demo-project-only seeded users + switcher; password sign-in disabled in pilot project |
| Product | (c) offline names | **Accepted** → `event_roster()` returns code hashes + names, cached on organizer device |
| Minimalist | jsqr only | **Accepted** |
| Minimalist | member_codes → column | **Rejected** — Security showed column revokes are fragile under default grants; a no-grant table is the simpler safe boundary |
| Minimalist | defer rotate_my_code | **Rejected** — Security relies on it for lost devices; ~3 lines |

## Appendix C: Round-3 notes (all non-blocking, applied)
- Database: tasks/events get `(guild_id, season_id) → seasons on delete cascade` so the retention purge can delete a season; `ai_usage.user_id` FK cascades.
- Security: `set_current_season` captain-only RPC; `user_id` dropped from the members column grant.
- Product: rehearse airplane-mode scan on a real iPhone (jsqr on iOS Safari is the riskiest live step); seed the demo sheet with a misspelled category so category matching shows in the preview.

## Appendix B: Round-1 resolution log
(See git history of this file; all 25 round-1 blockers accepted or superseded by ADR-2.)
