# Fuksipisteet — SDD v3.1 (consensus: all 5 debaters SATISFIED, round 6 — modelled on the real Data Guild roadmap)

Product: Aalto guilds track fuksi points (tasks + events → points → teekkari cap at Wappu). Today: a printed roadmap + Google Sheets + Telegram photos + manual counting.
Reference: `fuksi point roadmap for Data Guild.jpg`, a real guild's 6 tracks, 4 tiers, point ranges, write-ins and secret nodes.
Team: 3 (2 Claude Code, 1 Codex). Hackathon demo, then pilot with 1 guild (~150 fuksis, ~20 tutors) Oct–May.

## 0. Architecture rules (ADR summary)
- **ADR-1 Where logic lives.** Clients never write tables. Every write is a `security definer` Postgres RPC. Clients get **explicit SELECT grants only**; RLS filters rows. Edge Functions only for secrets/external calls. Next.js = UI + reads.
- **ADR-2 Check-in direction.** Organizer device scans the fuksi's personal QR (random 128-bit code) and queues offline.
- **ADR-3 Seasons.** `season_id` on every domain row; composite FKs include it; one `is_current` season per guild; helpers resolve the current season only.
- **ADR-4 (revised v3) A node is the unit of progress.** Every map node is a `task`. Points are earned **only** as `submissions` rows, whether from a fuksi submission or an organizer check-in (an event points at its task). One internal function `award_task()` owns the lock, the `max_repeats` count, the point range and the snapshot. **No other code awards points.**
- **ADR-5 Categories are rows.** Composite FKs everywhere; import maps names case-insensitively.
- **ADR-6 (new) Tiers.** Named levels (Teekkari 40 → Professor 100) are rows in `tiers`. A member reaches a tier when total ≥ `min_total`, every applicable category `rules` row is met, and every `required` task is approved.

## 1. Roles
`fuksi` · `tutor` (approves own group; can scan) · `organizer` (can scan) · `captain` (everything). Invites only create `fuksi`; staff roles only via `set_role`.
Per-task reviewer: `tasks.reviewer` = `tutor` (default) or `captain`. Use `captain` for uncapped/wide-range tasks (jäynä) and person-specific ones ("Tell Fuksi Major a joke").

## 2. Stack
| Area | Choice |
|---|---|
| App | Plain responsive Next.js (App Router) on Vercel. No PWA. |
| Photo capture | `<input type="file" capture>` → canvas re-encode JPEG ≤1600px (strips EXIF) → `crypto.subtle` SHA-256 |
| QR | Fuksi QR drawn on-device by `qrcode` from a localStorage-cached code. Organizer scans with `jsqr`. |
| Backend | Supabase, EU region: Postgres, Auth, RLS, Storage, pg_cron, 2 Edge Functions |
| Auth | Email 6-digit OTP, `@aalto.fi` via auth hook, custom SMTP + raised rate limits |
| Demo login | Demo project only: seeded users + "log in as" switcher (`NEXT_PUBLIC_DEMO=1`); pilot project has password sign-in disabled |
| AI | Claude Haiku 4.5 in `import` only: column mapping on headers + masked samples |
| **Roadmap view** | **Main fuksi screen = the guild's map.** Phone: one stacked card per category (icon, "9/14p", time-ordered node chain that scrolls sideways). Projector: full 2D map. Colors/icons from a fixed 6-slot palette by category order (`ponytail: hardcoded palette, add categories.color/icon when a 2nd guild needs its own look`). |
| Leaderboard | Projector polls `leaderboard()` every 5 s; animated |
| Export | Member × category matrix + tier per member; **formula-injection-safe CSV** |

## 3. Schema (migration 0001 — frozen day 0)
Unchanged from v2.1 unless marked **v3**: privilege block (revoke all + explicit grants), `guilds`, `seasons` (+`is_current`), `categories`, `tutor_groups`, `members`, `member_codes`, `adjustments`, `invites`, `ai_usage`.

```sql
-- v3: tasks = map nodes
create table tasks (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, category_id bigint not null,
  title text not null, description text,
  points_min int not null check (points_min between 0 and 100),
  points_max int not null,                                     -- jäynä "1-∞p" = a captain-set ceiling, e.g. 10
  check (points_max between points_min and 100),
  reviewer text not null default 'tutor' check (reviewer in ('tutor','captain')),
  check (points_max - points_min <= 2 or reviewer = 'captain'), -- wide ranges are captain-only
  max_repeats int not null default 1 check (max_repeats between 1 and 50),  -- "Work Point ×2" = one task, max_repeats 2
  required boolean not null default false,                     -- "Mandatory" nodes that must each be done
  requires_photo boolean not null default true,
  requires_note boolean not null default false,                -- write-in slots: note = event name
  revealed_at timestamptz not null default now(),              -- secret nodes: 'infinity' until captain reveals
  active boolean not null default true,                        -- retired, not secret
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  unique (guild_id, season_id, id),
  unique (guild_id, season_id, id, category_id));                -- lets submissions pin their category snapshot
-- display order = id (import preserves sheet/map order). ponytail: add tasks.sort when a captain needs to reorder.

-- v3: tiers
create table tiers (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  name text not null, min_total int not null check (min_total > 0),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  unique (guild_id, season_id, name), unique (guild_id, season_id, min_total),
  unique (guild_id, season_id, id));

-- v3: rules = category minimums; tier_id null = applies to every tier
create table rules (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  category_id bigint not null, tier_id bigint,
  min_points int not null check (min_points > 0),               -- import skips "[0]" categories
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, category_id) references categories (guild_id, season_id, id),
  foreign key (guild_id, season_id, tier_id) references tiers (guild_id, season_id, id) on delete cascade,
  unique nulls not distinct (guild_id, season_id, category_id, tier_id));

-- v3: events point at a node; no own points/category
create table events (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, task_id bigint not null,
  title text not null,
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  foreign key (guild_id, season_id, task_id) references tasks (guild_id, season_id, id),
  unique (guild_id, season_id, id));
-- One physical event, two nodes (Sitsit: Work 2p + Culture 1p) = two events (e.g. "Sitsit — workers").

-- v3: submissions absorb checkins (checkins table removed)
create table submissions (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null,
  task_id bigint not null, category_id bigint not null,          -- category snapshot: progress never joins tasks
  member_id bigint not null,
  event_id bigint,                                              -- set = earned by check-in
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  points_awarded int check (points_awarded >= 0),
  award_reason text check (length(award_reason) <= 300),        -- required when points_awarded > points_min
  photo_path text, photo_sha256 text,
  note text check (length(note) <= 500),
  reviewed_by bigint, reviewed_at timestamptz,                  -- check-in: scanner + scanned_at
  created_at timestamptz not null default now(),                -- check-in: synced_at
  foreign key (guild_id, season_id, task_id, category_id) references tasks (guild_id, season_id, id, category_id)
    on update cascade on delete cascade,                         -- recategorising a task moves its points too
  foreign key (guild_id, season_id, member_id)   references members    (guild_id, season_id, id) on delete cascade,
  foreign key (guild_id, season_id, event_id)    references events     (guild_id, season_id, id),  -- no action: deleting an event never erases approved points
  foreign key (guild_id, season_id, reviewed_by) references members    (guild_id, season_id, id) on delete set null (reviewed_by),
  check ((status = 'approved') = (points_awarded is not null)),
  check (event_id is null or status = 'approved'));
create unique index on submissions (event_id, member_id) where event_id is not null;
create index on submissions (guild_id, status, member_id);
create index on submissions (member_id) where status = 'approved';
create index on submissions (guild_id, photo_sha256);
create index on submissions (photo_path);
```

Views (`security_invoker`):
- `progress(member_id, category_id, points)` = Σ approved `submissions.points_awarded` + Σ `adjustments.points`, grouped by the **snapshotted** `category_id`. It never joins `tasks`, so hidden nodes can't distort a fuksi's total.
- `member_tier(member_id, tier_id)` = highest tier `t` where total ≥ `t.min_total`, every `rules` row `r` with `r.tier_id is null or rt.min_total <= t.min_total` is met (tier minimums are **cumulative**: Double Doctor also satisfies Doctor's rules), and no task with `required and active` lacks an approved submission. A member with no tier gets no row.

RLS helpers (security definer, current season): `is_member`, `has_role`, `my_member_id`, `is_tutor_of`, **`task_visible(task_id)`** = `revealed_at <= now()` or the caller is staff or owns a submission for it.

## 4. RPCs
| RPC | Who | Does |
|---|---|---|
| **`award_task(member_id, task_id, points, reason, source, event_id, reviewer_id, submission_id default null)`** | **internal only: `revoke execute … from public, anon, authenticated`** | Advisory lock `hashtextextended(member_id‖':'‖task_id,0)`. Counts pending+approved rows **excluding `submission_id`**; if ≥ `max_repeats` → `limit_reached`. Checks `points_min ≤ points ≤ points_max`, and that reason is set if points > `points_min`. If `submission_id` is set, UPDATE … `where id = submission_id and status = 'pending' and member_id = $member and task_id = $task`, and raise if 0 rows; otherwise INSERT an approved row with snapshot `category_id`. For check-ins, the duplicate check runs **before** the limit check, then insert with `on conflict (event_id, member_id) where event_id is not null do nothing` → `duplicate`. Callers pass `reviewer_id := my_member_id()`, never client input. Lane A owns it. |
| `submit_task(task_id, note, photo_path, photo_sha256, with_member_ids)` | fuksi | Rejects if not `task_visible` / not `active`. Enforces `requires_note`/`requires_photo` and the `max_repeats` pre-check (same lock). Inserts `pending`. |
| `review_submissions(ids, approve, points default null, reason default null)` | `tasks.reviewer` role (tutor of member, or captain) | **Pending rows only.** On approve: calls `award_task(…, submission_id := id)`, with points defaulting to `points_min`. "Approve all" = `points_min` for each. Reject = set `rejected` (no award). |
| `checkin(event_id, member_code, scanned_at)` | organizer/tutor/captain | Resolves the code, checks the time window (±2 h, ≤24 h old), then `award_task(points_min, source='checkin', reviewer=scanner)`. Ignores `revealed_at`. Returns `ok | duplicate | limit_reached | unknown | outside_window`. Lane C writes **only** the resolve/window part. |
| `roadmap(guild_id)` | member | Visible nodes with own status (dim / pending / lit, repeat dots). **Hidden nodes appear as locked placeholders** `{category_id, locked: true}`, with no title or points. Tiers + own tier. |
| `update_task(task_id, …)` | captain | Includes reveal (`revealed_at = now()`) and scheduled reveal. |
| `award_report(guild_id)` | captain | Awards above `points_min`, grouped by reviewer (audit). |
| unchanged | | `join_guild`, `event_roster`, `my_code`, `rotate_my_code`, `set_role`, `set_current_season`, `add_adjustment`, `import_apply` (also tiers, ranges, required, write-in slots; skips 0-minimum rules), `leaderboard`, `captain_roster`, invites |

## 5. Security & privacy
v2.1 privileges, matrix, storage, retention and GDPR, **plus**:
- **Secret nodes:** fuksi SELECT on `tasks` and `events` uses `task_visible()`. `submit_task` rejects hidden tasks. `roadmap()` shows only locked placeholders. pgTAP covers: hidden title unreadable, hidden event unreadable, hidden task unclaimable by id, owner can see after check-in.
- **award_task pgTAP:** `authenticated` cannot execute it; approving at `max_repeats = 1` succeeds; approving when the limit is already met → `limit_reached`; double check-in → `duplicate`; a mismatched or already-approved `submission_id` raises.
- **Point inflation:** wide or uncapped ranges are captain-reviewed by a schema CHECK. Awards above min need `award_reason`. Only pending rows are reviewable; corrections go through `adjustments`. `award_report` gives the captain an audit.
- **Export:** cells starting with `= + - @ \t \r` are prefixed with `'` (formula injection).
- **Write-ins:** text rendered by React only (never `dangerouslySetInnerHTML`); 500-char limit.
- **Sensitive proofs:** "10 ECTS credits" is `requires_photo = false`, checked by the tutor in person. The privacy notice says: never upload transcripts.

## 6. Key flows
1. **Onboard:** captain imports the sheet or roadmap (AI mapping preview), giving categories, nodes (ranges, repeats, required, secret), tiers, rules, roster and opening balances. Then invite → OTP → join.
2. **Map:** fuksi home = roadmap cards + tier ladder ("12p to Teekkari"). Tapping a node opens the submit sheet. The 8 grey write-in pills ("+ my own event") open with an "Event name" field.
3. **Approve:** tutor queue (or captain queue for captain-reviewed nodes). Swipe, with a points stepper defaulting to min. "Approve all" = min.
4. **Check-in:** organizer scans → node lights up. `limit_reached`/`unknown`/`outside_window` are shown and stop retrying.
5. **Reveal:** captain taps reveal → keyhole unlocks on the next poll (projector + phones).
6. **Export:** matrix + tier per member.

## 7. Build slices
1. **Walking skeleton (day 1):** 0001 + `award_task` + seed (the real DG map as seed data) + demo login → **roadmap view** → submit → approve → node lights up → projector.
2. **Auth & hardening:** OTP, SMTP, auth hook, invites, roles, pgTAP suite (incl. secret-node and inflation tests).
3. **Check-in:** offline QR + scanner + queue (tests: reload replay, idempotent, `limit_reached` surfaces).
4. **Photos:** capture, storage, purge, duplicates, approve-all, points stepper.
5. **Import/export + reveal + polish.**

Demo (3 min): fuksi opens their map → organizer scans at an event and a node lights up → tutor approves a photo and picks 2p → tier ladder ticks → **captain reveals a keyhole and it unlocks on the projector** → mention import and export.

## 8. Lanes & contracts
- Day-0 contract: 0001 (incl. `award_task`), RPC signatures, generated types.
- **A:** schema, privileges, `award_task`, all RPC bodies except the check-in resolve/window, pgTAP.
- **B:** roadmap view, submit/approve UI, photos, export, polish.
- **C (Codex):** `/organizer/*`, `checkin` resolve/window + `event_roster`, queue tests, `supabase/functions/*`.

## 9. Open questions (ask Data Guild before slice 2; do not block slice 1)
1. Must every Mandatory node be done (`required`), or is the category minimum enough?
2. Is 40p a hard requirement for the cap, or a recommendation?
3. Do higher tiers also need category minimums? (Supported via `rules.tier_id`.)
4. Keyholes and the map piece: unlocked by date or by an achievement? Which category, how many points?
5. Who awards jäynä points, and what is a sensible ceiling?
6. May we reproduce the map's artwork and icons in the app?

---
## Appendix D: Round-4 resolution log (map-driven)
| Proposal | Outcome | Decided by |
|---|---|---|
| P1 ranges | `points_min/max` (not null; jäynä = captain ceiling); CHECK makes wide ranges captain-only; `award_reason` above min | Minimalist (no null), Security (captain-only, reason, pending-only), Database (CHECKs) |
| P2 tiers | `tiers` table + `rules.tier_id` (null = every tier); `member_tier` view | Database + Architect, **over** Minimalist's tiers-as-rules (two row kinds in one table, and per-tier minimums impossible) |
| P3 write-ins | `requires_note`, enforced in RPC; grey pills UI | all |
| P4 secrets | `revealed_at not null default now()` ('infinity' = hidden); `task_visible()` on tasks+events; submit rejects; locked placeholders via `roadmap()` | Database (NULL bug), Security (3 leaks), Product (visible keyholes), **over** Minimalist's reuse of `active` (secret ≠ retired) |
| P5 events→nodes | Accepted; **checkins merged into submissions** (`event_id`, partial unique); `award_task()` single owner; `limit_reached` | Database + Minimalist (merge), Architect (B1 single function), Security + Minimalist (`limit_reached`) |
| P6 roadmap | Stacked category cards on phone, full map on projector, 4 node states; **no color/icon/sort columns** (palette + id order) | Product (UX), Minimalist (no columns) |
| P7 mandatory | **Reversed** → `tasks.required` | Product + Database (Captain's Quarters 1–2p lets a fuksi skip a mandatory node) |
| Missed | 0-minimum categories skipped on import; duplicate nodes = `max_repeats`; Sitsit worker/attendee = two events; ECTS no photo; Major's joke = captain reviewer; formula-safe CSV; category snapshot on submissions | Architect, Security, Database, Minimalist |

(Earlier appendices A–C are in git history: v2.1 commit `a35a32b`.)
