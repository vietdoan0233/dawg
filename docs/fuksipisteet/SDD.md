# Fuksipisteet — SDD v4 (v3.2 + §11: individual leaderboard, no tutor groups, fuksi home)

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
- **ADR-7 (v4) Individual board, no tutor groups.** Product owner: fuksis in a guild already know each other, so every guild member sees every fuksi's name, points, level and rank. Fuksis are not grouped by tutors, so every tutor of a guild reviews every fuksi of that guild (`is_tutor_of` = same guild + current season + target is a fuksi other than the caller). Consequences: RLS widens to "any guild tutor sees every guild fuksi's submissions and proofs" (never staff rows, never other guilds), and the shared queue makes review collisions normal, so `review_submissions` reports them per row (`already_reviewed`) instead of rolling back the batch. Details in §11.

## 1. Roles
`fuksi` · `tutor` (approves own group; can scan — *superseded by §11: approves every fuksi in the guild*) · `organizer` (can scan) · `captain` (everything). Invites only create `fuksi`; staff roles only via `set_role`.
Per-task reviewer: `tasks.reviewer` = `tutor` (default) or `captain`. Use `captain` for uncapped/wide-range tasks (jäynä) and person-specific ones ("Tell Fuksi Major a joke").

## 2. Stack
| Area | Choice |
|---|---|
| App | Plain responsive Next.js (App Router) on Vercel. No PWA. |
| Photo capture | `<input type="file" capture>` → canvas re-encode JPEG ≤1600px (strips EXIF); SHA-256 of the stored file computed server-side by the `purge-photos` job (the phone's hash is ignored) |
| QR | Fuksi QR drawn on-device by `qrcode` from a localStorage-cached code. Organizer scans with `jsqr`. |
| Backend | Supabase, EU region: Postgres, Auth, RLS, Storage, pg_cron, 2 Edge Functions |
| Auth | Email 6-digit OTP, `@aalto.fi` via auth hook, custom SMTP + raised rate limits |
| Demo login | Demo project only: seeded users + "log in as" switcher (`NEXT_PUBLIC_DEMO=1`); pilot project has password sign-in disabled |
| AI | Claude Haiku 4.5 in `import` only: column mapping on headers + masked samples |
| **Roadmap view** | (superseded by §11.2: home page first, map behind a category tap) **Main fuksi screen = the guild's map.** Phone: one stacked card per category (icon, "9/14p", time-ordered node chain that scrolls sideways). Projector: full 2D map. Colour and icon come from each category row (`categories.color`, `categories.icon`), and import pre-fills them from a default palette. |
| Leaderboard | Projector polls `leaderboard()` every 5 s; animated (superseded by §11: individual, live everywhere) |
| Export | Member × category matrix + tier per member; **formula-injection-safe CSV** |

## 3. Schema (migration 0001 — frozen day 0)
Unchanged from v2.1 unless marked **v3**: privilege block (revoke all + explicit grants), `guilds`, `seasons` (+`is_current`), `tutor_groups` (superseded by §11: dropped in 0008), `members`, `member_codes`, `adjustments`, `invites`, `ai_usage`.

```sql
-- v3.2: categories carry their own look (guilds differ in track count, colours, icons)
create table categories (
  id bigint generated always as identity primary key,
  guild_id bigint not null, season_id bigint not null, name text not null,
  color text not null default '#888888' check (color ~ '^#[0-9a-f]{6}$'),
  icon text not null default 'hex' check (icon in ('cog','bell','goblet','tower','shield','hex','star','book','heart','flag')),
  foreign key (guild_id, season_id) references seasons (guild_id, id) on delete cascade,
  unique (guild_id, season_id, name), unique (guild_id, season_id, id));
-- display order = id. ponytail: add categories.sort when a captain needs to reorder.

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

RLS helpers (security definer, current season): `is_member`, `has_role`, `my_member_id`, `is_tutor_of` (superseded by §11: any tutor of the guild), **`task_visible(task_id)`** = `revealed_at <= now()` or the caller is staff or owns a submission for it.

## 4. RPCs
| RPC | Who | Does |
|---|---|---|
| **`award_task(member_id, task_id, points, reason, source, event_id, reviewer_id, submission_id default null)`** | **internal only: `revoke execute … from public, anon, authenticated`** | Advisory lock `hashtextextended(member_id‖':'‖task_id,0)`. Counts pending+approved rows **excluding `submission_id`**; if ≥ `max_repeats` → `limit_reached`. Checks `points_min ≤ points ≤ points_max`, and that reason is set if points > `points_min`. If `submission_id` is set, UPDATE … `where id = submission_id and status = 'pending' and member_id = $member and task_id = $task`, and raise if 0 rows; otherwise INSERT an approved row with snapshot `category_id`. For check-ins, the duplicate check runs **before** the limit check, then insert with `on conflict (event_id, member_id) where event_id is not null do nothing` → `duplicate`. Callers pass `reviewer_id := my_member_id()`, never client input. Lane A owns it. |
| `submit_task(task_id, note, photo_path, photo_sha256, with_member_ids)` | fuksi | Rejects if not `task_visible` / not `active`. Enforces `requires_note`/`requires_photo` and the `max_repeats` pre-check (same lock). Inserts `pending`. |
| `review_submissions(ids, approve, points default null, reason default null)` | `tasks.reviewer` role (tutor of member, or captain; superseded by §11: any guild tutor) | **Pending rows only.** On approve: calls `award_task(…, submission_id := id)`, with points defaulting to `points_min`. "Approve all" = `points_min` for each. Reject = set `rejected` (no award). Per-row result `ok | limit_reached | rejected | already_reviewed` (the last one added by §11.1 step 4c). |
| `checkin(event_id, member_code, scanned_at)` | organizer/tutor/captain | Resolves the code, checks the time window (±2 h, ≤24 h old), then `award_task(points_min, source='checkin', reviewer=scanner)`. Ignores `revealed_at`. Returns `ok | duplicate | limit_reached | unknown | outside_window`. Lane C writes **only** the resolve/window part. |
| `roadmap(guild_id)` | member | Visible nodes with own status (dim / pending / lit, repeat dots). **Hidden nodes appear as locked placeholders** `{category_id, locked: true}`, with no title or points. Tiers + own tier. |
| `update_task(task_id, …)` | captain | Includes reveal (`revealed_at = now()`) and scheduled reveal. |
| `award_report(guild_id)` | captain | Awards above `points_min`, grouped by reviewer (audit). |
| unchanged | | `join_guild`, `event_roster`, `my_code`, `rotate_my_code`, `set_role`, `set_current_season`, `add_adjustment`, `import_apply` (also tiers, ranges, required, write-in slots; skips 0-minimum rules; colours `lower()`-ed), `leaderboard`, `captain_roster`, invites |

## 5. Security & privacy
v2.1 privileges, matrix, storage, retention and GDPR, **plus**:
- **Secret nodes:** fuksi SELECT on `tasks` and `events` uses `task_visible()`. `submit_task` rejects hidden tasks. `roadmap()` shows only locked placeholders. pgTAP covers: hidden title unreadable, hidden event unreadable, hidden task unclaimable by id, owner can see after check-in.
- **award_task pgTAP:** `authenticated` cannot execute it; approving at `max_repeats = 1` succeeds; approving when the limit is already met → `limit_reached`; double check-in → `duplicate`; a mismatched or already-approved `submission_id` raises.
- **Point inflation:** wide or uncapped ranges are captain-reviewed by a schema CHECK. Awards above min need `award_reason`. Only pending rows are reviewable; corrections go through `adjustments`. `award_report` gives the captain an audit.
- **Export:** cells starting with `= + - @ \t \r` are prefixed with `'` (formula injection).
- **Write-ins:** text rendered by React only (never `dangerouslySetInnerHTML`); 500-char limit.
- **Sensitive proofs:** "10 ECTS credits" is `requires_photo = false`, checked by the tutor in person. The privacy notice says: never upload transcripts.
- **v4 public board (GDPR Art. 13):** the privacy notice, shown at `join_guild` before the first login, lists exactly the fields `leaderboard()` and `activity()` return (name, total, level, weekly points, rank and rank movement, and dated "name · task · +Np" activity), who sees them (every member of the guild, plus the event projector, which non-members in the room can see), and how long they are kept (the feed covers 7 days; totals are kept for the season, then follow the existing retention). It is a pilot gate (§11.6 lane C), not a hackathon gate: the demo uses seeded fake users.

## 6. Key flows
1. **Onboard:** captain imports the sheet or roadmap (AI mapping preview), giving categories, nodes (ranges, repeats, required, secret), tiers, rules, roster and opening balances. Then invite → OTP → join.
2. **Map:** (superseded by §11.2) fuksi home = roadmap cards + tier ladder ("12p to Teekkari"). Tapping a node opens the submit sheet. The 8 grey write-in pills ("+ my own event") open with an "Event name" field.
3. **Approve:** (superseded by §11: one shared tutor queue per guild) tutor queue (or captain queue for captain-reviewed nodes). Swipe, with a points stepper defaulting to min. "Approve all" = min.
4. **Check-in:** organizer scans → node lights up. `limit_reached`/`unknown`/`outside_window` are shown and stop retrying.
5. **Reveal:** captain taps reveal → keyhole unlocks on the next poll (projector + phones).
6. **Export:** matrix + tier per member.

## 7. Build slices
1. **Walking skeleton (day 1):** 0001 + `award_task` + seed (the real DG map as seed data) + demo login → **roadmap view** → submit → approve → node lights up → projector.
2. **Auth & hardening:** OTP, SMTP, auth hook, invites, roles, pgTAP suite (incl. secret-node and inflation tests).
3. **Check-in:** offline QR + scanner + queue (tests: reload replay, idempotent, `limit_reached` surfaces).
4. **Photos:** capture, storage, purge, duplicates, approve-all, points stepper.
5. **Import/export + reveal + polish.**

Demo (3 min, v4): fuksi home shows "**12p to Doctor**" and the unmet chips → organizer scans at an event and a node lights up → tutor approves a photo and picks 2p → the phone toasts "**You moved up to #6**" and the projector board FLIPs within 5 s, with the MVP crown → **captain reveals a keyhole and it unlocks on the projector** → mention import and export. Rehearsed as a Playwright run at 1280x720 (§11.6 lane C). Fallback: the v3.2 tree demo, tagged `demo-v3.2` before lane C starts.

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

## 10. Multiple guilds (each guild runs its own rules)
**Principle: a guild's rules are data, not code.** Every rule lives in rows scoped by `(guild_id, season_id)`, so guilds never share or overwrite each other's setup, and each new season can change the rules without a migration.

| What differs between guilds | Where it lives | Who sets it |
|---|---|---|
| Tracks (how many, names, colours, icons) | `categories` | captain / import |
| Nodes, point values and ranges, repeats | `tasks` (`points_min/max`, `max_repeats`) | captain / import |
| Track minimums | `rules` | captain / import |
| Levels and thresholds (40/60/80/100 or anything else) | `tiers`, with per-tier minimums via `rules.tier_id` | captain / import |
| Must-do nodes | `tasks.required` | captain |
| Secret nodes and reveal dates | `tasks.revealed_at` | captain |
| Who may approve a node | `tasks.reviewer` | captain |
| Which events light which node | `events.task_id` | captain / organizer setup |
| Season dates | `seasons` | captain |
| Points earned before switching apps | `adjustments` (opening balances, via import) | captain |
| One-off corrections, bonuses, penalties | `adjustments` (reason required, audited) | captain |

**Editing mid-season:** it depends on what is edited.
- **Point values** (`points_min/max`) apply to **future** awards only. Points already earned stay as awarded (ADR-4 snapshot). To change them retroactively, the captain uses `adjustments`, which keeps the change visible and audited.
- **Everything else is recomputed for everyone immediately:** a task's category (its past points move with it), `required`/`active`, `rules` and `tiers`. Every member's tier and the export change at once. The captain edit screen shows how many members' tiers would change before saving, computed from `member_tier`.

**Rules the model does not express yet:** a cap on how many points a track can contribute, points that expire, team-level points, and points moved between fuksis.
- **Policy:** until then, the captain handles these with `adjustments`.
- **When to build it:** once a **second** guild needs the same rule, add it as data (e.g. `rules.max_points`) in a new migration. Don't special-case one guild in code.

**Onboarding a new guild:** a platform admin runs `bootstrap_guild(name, slug, captain_email)` once. It is a service-role SQL function, not callable by clients. It creates three things:
- the guild and its first (current) season,
- an **unclaimed roster row** `(email = captain_email, role = 'captain', user_id = null)`,
- an ordinary invite (`max_uses 1`, expires in 7 days).

The admin sends that link to the captain. The existing `join_guild` email-claim path makes only the OTP-verified owner of that email captain; anyone else using the link gets `fuksi`. There are no new invite semantics: invites still never carry a role. pgTAP covers it: a different email joining through the bootstrap invite gets `fuksi`, and no client-created invite can ever produce a captain. The captain then imports their sheet or roadmap, and everything else is self-service.

## 11. v4: individual leaderboard, no tutor groups, fuksi home & game loop
Product-owner decisions (not open questions): (1) the leaderboard is **individual**: every guild member sees every fuksi's name, points and rank, because fuksis in a guild already know each other; (2) **no tutor groups**: every tutor reviews every fuksi in their guild; (3) one live leaderboard for everyone; (4) a fuksi **home page** (points vs next goal → categories → skill tree with a category sidebar); (5) a small, habit-forming game loop; (6) the tree pans and zooms at 60 fps. This section overrides older text marked "(superseded by §11)".

### 11.1 Data: migration `0008_v4_individual_ranks.sql` (0001 stays frozen)
No new tables, so every multi-guild rule (§0, §10) holds unchanged. In order:
1. **`is_tutor_of(p_member_id)`**: `create or replace`, same signature. The `tutor_group_id` join goes, and the new body names the target as well as the caller: `me.role = 'tutor' and tgt.role = 'fuksi' and tgt.id <> me.id and tgt.guild_id = me.guild_id and tgt.season_id = me.season_id and me.season_id = public.current_season(me.guild_id)`. So a tutor is "tutor of" every **fuksi** in the guild, but never of themselves or of other staff. A fuksi promoted mid-season cannot approve their own pending rows (`review_submissions` raises `forbidden`) or read staff proofs. It is the shared function, so all six callers switch at once with no other edit: `submissions_select`, `adjustments_select`, `proofs_select` (storage), `review_submissions`, `duplicate_photos` and `required_missing`. Keep the name: renaming means rewriting six policies and functions for no change in behaviour.
2. **`required_missing(p_member_id)`**: the access clause becomes `public.is_member(m.guild_id)`. This is required, not optional: `leaderboard()` is a definer, but `auth.uid()` is still the caller, so for other members the old self/captain/tutor clause returned `false`, and `member_tier` would show a too-high level whenever a mandatory node was still undone. Levels are public now, so the boolean leaks nothing new.
3. **`leaderboard(p_guild_id)`**: `drop function` + `create` (the return type changes). Definer; raises `forbidden` unless `is_member`. It returns one row per `role = 'fuksi'` member of the current season, **including unclaimed roster rows** (`user_id is null`: imported fuksis with opening balances who have not logged in yet; they are real people in the guild). Staff never get a row, and other guilds never appear.
   `(member_id bigint, display_name text, total int, tier_name text, week_points int, rank int, rank_week_ago int)`
   - `total` = `sum(points)` from the existing `progress` view, the same definition `roadmap()` and `member_tier` use, so the three can never disagree.
   - **One definition of "week"** (used by `week_points`, the MVP, rank movement, `+Np` and `activity()`): a rolling `now() - interval '7 days'` window, counting **approved submissions only**. The timestamp is `coalesce(reviewed_at, created_at)`: for reviewed submissions that is server time; for check-ins `reviewed_at` is the organizer device's `scanned_at` (migration 0007), which `checkin` bounds to 24 h in the past and 5 min in the future, so an offline-synced check-in counts from when it was scanned, up to a day before it reached the server. That is accepted: it is bounded, set by the organizer's device rather than the fuksi, and it is the honest time of the event. `week_points = coalesce(sum(s.points_awarded) filter (where coalesce(s.reviewed_at, s.created_at) >= now() - interval '7 days'), 0)`. Adjustments (opening balances, bonuses, penalties) count in `total` and therefore in the week-ago baseline, but never in `week_points`, so an import day does not crown whoever had the biggest legacy balance, and a −5 penalty is not "negative activity".
   - `rank` = `rank() over (order by total desc)` (ties share a rank). `rank_week_ago` = `rank() over (order by total - week_points desc)`.
   - `tier_name` comes from `member_tier ⋈ tiers`. Pinned query shape: filter the fuksi set first (`f` = this guild, current season, `role = 'fuksi'`), then `left join lateral (select tier_id from public.member_tier mt where mt.member_id = f.id) mt on true`, so the plan evaluates `member_tier` once per guild fuksi and never scans other guilds' members.
   - It returns no categories, notes, photos or emails. Order by `rank, display_name`.
4. **`activity(p_guild_id, p_limit int default 20)`** (new): definer, `is_member`, limit clamped to 1..50. It returns the newest approved submissions of fuksis in the current season, in the same rolling 7-day window, on tasks with `active = true`: `(at, member_id, display_name, category_id, task_title, points, secret bool)`.
   - `task_title` is `null` and `secret = true` while the task's `revealed_at > now()`.
   - It never returns a note, photo path, award reason or reviewer. The select list is explicit (no `select *`), and pgTAP asserts the exact result columns. Adjustments are left out, matching `week_points`.
4b. **`roadmap(p_guild_id)`**: `create or replace` (still returns `jsonb`) and adds one key, **`next_tier`**, computed in SQL with the same predicate as `member_tier` (`r.tier_id is null or rt.min_total <= t.min_total`, plus `required_missing`): `{tier_id, name, points_needed, unmet: [{category_id, have, need}], required_missing int}` for the lowest tier above the member's current one, or `null` at the top level. `required_missing` counts undone required nodes, **including hidden ones**, without revealing which. The tier rule then has exactly one home (SQL); the client only renders it. The predicate is still written twice in SQL (`member_tier` and here), so pgTAP holds them in parity (see `10_v4`). ponytail: extract a `tier_gap(member, tier)` helper both use when a third caller appears.
4c. **`review_submissions(ids, approve, points, reason)`**: `create or replace` with the same signature and return type `(submission_id bigint, result text)`. With one shared queue per guild (decision 2, ~20 tutors), two tutors reviewing the same row is normal, so a stale row must no longer roll back the batch. After the advisory lock and the status re-read, a row whose status is not `pending` does `submission_id := id; result := 'already_reviewed'; return next; continue;` instead of raising `not_pending`. On the reject path, the `update … where status = 'pending'` that finds no row returns `already_reviewed` the same way. Everything else is unchanged: a missing id, an id the caller may not review, or a row from an old season still raises `forbidden` for the whole batch (that is a bad request, not a race), and `limit_reached` stays a per-row result. Per-row result enum (contract, §11.6): **`ok | limit_reached | rejected | already_reviewed`**. `ok` is the existing approve value; it is not renamed to `awarded` because `ReviewQueue.tsx` and pgTAP already match on it.
5. **`set_role`**: drop `(bigint, text, bigint)`, then create `(bigint, text)` with the same body minus the group.
6. **`import_apply`**: `create or replace` with the same signature. The member loop drops the group lookup and insert. A `tutor_group_name` key is now ignored (it is no longer in the recordset column list).
7. **Drop groups**: `alter table members drop column tutor_group_id` (Postgres drops its FK, its index and its column grant along with it). Then `drop table tutor_groups` (its policy and grant go with it).
8. **Grants**: `revoke all … from public, anon` and `grant execute … to authenticated` on `leaderboard(bigint)`, `activity(bigint,int)` and `set_role(bigint,text)`. Supabase's default privileges would otherwise expose new functions to `anon`.
- Accepted widening (Security, record it): any tutor now sees every guild **fuksi's** submissions and proof photos (not staff rows, and not their own). The table stays `tutors ⊂ staff ⊂ guild`, and a tutor of another guild still sees nothing.
- **Cost**: `leaderboard()` evaluates `member_tier` for each fuksi, and at pilot size (~150 fuksis polling every 15 s, plus `activity()` and the 5 s projector) that is about 10 calls/s. Gate: `explain (analyze, buffers)` of `leaderboard()` and `activity()` with **150 fuksis × ~40 approved submissions each, plus a second guild of the same size**, each under 50 ms, with the plan showing `member_tier` evaluated once per guild fuksi. Record the numbers in PROGRESS.md. If the plan shows a Seq Scan on `submissions`, add `create index on submissions (guild_id, season_id, (coalesce(reviewed_at, created_at)) desc) where status = 'approved'`. ponytail: when a bigger guild breaks the gate, cache totals in a table that `award_task` maintains. Don't do it before then.
- **Import/export**: the CSV guesser (`lib/csv.ts`) and `map-columns` drop the `group` target, so a "Tutor group" column guesses `skip`. Export drops the "Tutor group" column.
- **Seed**: `seed.sql` drops `tutor_groups`, `grp_a`/`grp_b` and the `tutor_group_id` values. Tutors A and B stay as two plain tutors.
- **`demo-crowd.sql`**: insert 4 tutors without groups. Each crowd row's reviewer = a random tutor. Pending rows land in the one shared queue. The closing summary prints the top 10 from `leaderboard()` maths (name, total, week points) instead of group totals.
- **pgTAP**:
  - Edits:
    - `03_flow`: tutor B **can** review fuksi 1; the leaderboard asserts individual totals; tutor A **does** learn `required_missing` of f3; the two `throws_ok … 'not_pending'` cases (re-approve and stale reject of an approved row) become `is(result, 'already_reviewed')`, and the row stays `approved` with its original points.
    - `05_multi_guild`: guild 2's leaderboard has none of guild 1's members.
    - `06_demo_flow` / `09_hardening`: the "another group's tutor" cases become "a tutor of **another guild**".
    - `08_import`: a `tutor_group_name` key is accepted and ignored.
    - `01_privileges`: the new signatures.
  - New `10_v4.test.sql`:
    - a fuksi sees every fuksi with name, total and level;
    - staff get no row;
    - a non-member gets `forbidden`;
    - another guild gets no rows;
    - `rank_week_ago` reflects a point backdated 8 days;
    - the level shown for **another** fuksi with an undone required node is correct;
    - `activity` hides the title of an unrevealed task and never carries notes;
    - `anon` cannot execute either RPC;
    - `tutor_groups` no longer exists, and a catalog guard finds no function body that still mentions it: `select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~* 'tutor_group'), 0::bigint)` (function bodies are not dependency-tracked, so `drop table` alone would not catch a missed one);
    - `set_role(bigint,text)` works and the 3-argument version is gone;
    - a fuksi promoted to tutor with a pending row cannot review it (`forbidden`), and a tutor cannot select another tutor's or the captain's submissions;
    - an opening-balance adjustment created today leaves `week_points = 0`, raises `total`, and gives no MVP;
    - `activity` skips inactive tasks and returns exactly its 7 documented columns;
    - `roadmap().next_tier` with a tier-scoped rule plus a **hidden** required node: `unmet` and `required_missing` are correct, and at the top tier it is `null`;
    - `next_tier` / `member_tier` parity: for every seeded fuksi, `next_tier` is `null` exactly when `member_tier` is the top tier, and a non-null `next_tier` never has empty `unmet`, `required_missing = 0` and `points_needed <= 0` all at once (that would mean the two predicates disagree about a reached level);
    - mixed review batch: tutor A approves 3 pending rows where 1 was already approved by tutor B → 2 rows `ok` + 1 `already_reviewed`; the 2 are `approved` afterwards (nothing rolled back) and the third keeps tutor B as `reviewed_by`; a reject batch with 1 already-approved row gives `rejected` + `already_reviewed` the same way;
    - a batch containing an id the caller may not review still raises `forbidden` and changes nothing.

### 11.2 Fuksi home (replaces "home = the tree", §6.2)
`/` for a fuksi shows a scrolling home page; `/?cat=<id>` shows the tree. Use `router.push`, so the phone's Back button returns home, and `replace` when switching category inside the tree. There is no new route and no state library.
- **Goal card**: the hub ring (reuse `Hub`) with the total, the current level and "**12p to Doctor**". Under it, one chip per `roadmap().next_tier.unmet` entry ("Culture 3/5p") and, if `required_missing > 0`, a "N must-do tasks left" chip. When `next_tier` is `null` it shows "Max level". **No tier logic in the client**: it renders `next_tier` as-is and never re-derives it from `categories[].min_points`.
- **Stat strip**: rank `#7` with ▲2/▼1 (`rank_week_ago - rank`), this week's `+Np`, and a weekly streak 🔥N (only your own). Every points, rank and week number uses `font-variant-numeric: tabular-nums`.
- **Categories**: one card per category with icon, colour, `points/min` bar, lit/total nodes, and a dot if something is pending. Tapping a card opens the tree, which flies to that branch (the existing `focusCat`).
- **Leaderboard preview**: the top 3 as a podium, then your row with one neighbour each side, then "See all". The full board opens in the existing `Panel`.
- **Activity**: the last 10 `activity()` rows, e.g. "Aino · Sitsit · +2p", or "Aino unlocked a secret task".
- **Dock**: My QR · Tree · Leaderboard.
- **Tree view + category sidebar**: a left rail with one button per category, plus Home at the top. It is icon-only, 56 px, on phones and shows icon, name and points from 720 px up. It replaces the `nav.tracks` chip row.
  - The active item is the category you are in. `SkillTree` reports it through a new prop, `onCategoryInView(catId)`, fired once per settle (the existing 700 ms timer) for the branch whose nodes are nearest the viewport centre.
  - Tapping a rail item flies the tree there.

### 11.3 Live leaderboard (fuksi home, staff Ranks tab, projector)
One `<Leaderboard>` component, in either compact (home) or full mode. "Live" means polling, as the rest of the app does:
- The projector and the staff tab poll every **5 s**; phones every **15 s**. Polling pauses while `document.hidden` and fires again on `visibilitychange`.
- The phone's `activity()` call shares that tick.
- No Realtime: Postgres Changes would need `submissions` in the publication, an RLS check per subscriber per row, and an aggregate re-fetch anyway. ponytail: switch to Realtime broadcast when polling load shows in Supabase metrics.
- Rows animate their position with the FLIP technique (measure the old position, then a `transform`/`opacity` transition only), using no library, with tabular numbers so the projector doesn't jitter.
- The projector shows the top 10, this week's MVP and the activity ticker instead of group totals.
- **Offline**: when a poll fails (basement, no signal), the home and board keep the last data and show an "Offline · updated 3 min ago" pill; the next successful poll clears it. The QR dock stays fully local and works offline.
- **Shared tutor queue** (§6.3, one per guild, ~20 tutors): sorted oldest-first. The server owns the collision: `review_submissions` returns `already_reviewed` for each row another tutor got to first (§11.1 step 4c) and still commits the rest of the batch. The client drops exactly the rows with that result and shows a quiet "N already done by others" count, not an error toast. It never infers collisions from an exception.

### 11.4 Game loop (small, high-impact set)
Kept, all derived from existing data with **no new tables**:
- **Next-goal ring + unmet minimums**: always shows one concrete next step.
- **Rank movement**: ▲/▼ against a week ago on every row. A rank-up toast ("You moved up to #6") and the level-up/track-complete celebrations are diffed against the **last-seen rank and total stored in `localStorage` per member** (wrapped in try/catch; missing storage just means no toast). On every home load and every poll, the client compares, celebrates once, then stores the new values. So an approval that lands while the app is closed still gets its moment the next time the fuksi opens it. Nothing is shown when the rank drops.
- **Weekly MVP**: the highest `week_points` (> 0) gets a crown on the board and the projector (ties share it). Weekly means the slow and steady also get a turn. Since `week_points` excludes adjustments, an import day crowns nobody.
- **Weekly streak**: the number of consecutive ISO weeks, counting this week or last, in which the fuksi **acted**: bucketed by `submissions.created_at` for rows whose status is now `approved`, so a Sunday task approved on Monday still counts for Sunday's week and the fuksi is never punished for tutor lag. It is computed on the phone from the fuksi's own `submissions` (RLS: own rows) in `lib/news.ts`. This is deliberately a different measure from the server's rolling 7-day `week_points` (that one is "points earned lately" and the other is "weeks you showed up"); both are documented here. A broken streak just shows "Start a streak this week", with no loss message.
- **Celebrations**: the existing neon draw-on, chime and level-up card, plus a **track complete** card when a category reaches its minimum. That card is the badge; there is no badge table.
- **Activity feed**: social proof that pulls people to events.
Guardrails (no dark patterns): no push notifications or e-mails, no countdowns or "expiring" rewards, no random/loot rewards, no shaming of last place or lost streaks, a feed capped at 20 rows (no infinite scroll), sound stays toggleable, every animation off under `prefers-reduced-motion`.
**Cut** (add only on a real ask): achievements/badge tables, XP/coins/shop, daily login rewards, reactions/comments, avatars/photos on the board, per-category boards, team or group competition, notifications.

### 11.5 Tree performance (60 fps)
**Target:** pan, pinch and wheel-zoom stay at ≥ 60 fps.
**How it's measured:** a Chrome DevTools Performance trace (chrome-devtools MCP is fine) with a 4× CPU throttle at 375 px, as Demo Fuksi 1 with the crowd loaded, over 10 s of continuous pan + zoom.
**Pass:** ≥ 95 % of frames ≤ 16.7 ms and no task > 50 ms. Repeat once on a real Android Chrome. Record the numbers in PROGRESS.md. The existing transform-in-a-ref and rAF paint stay.
Fixes:
1. `.tree-node.pending` animates `box-shadow` forever, and every paint re-rasterises the moving world layer. Make it an `::after` ring that animates only `transform` and `opacity`.
2. The neon paths use **three** `drop-shadow` filters each. Replace them with a wider, semi-transparent stroke drawn underneath (no filter). Keep a single `drop-shadow` only if the look needs it.
3. `memo(SkillNode)` plus one delegated click handler on the world (`data-id`). A 5 s poll that changed nothing then re-renders zero nodes.
4. Pan **inertia** on release: velocity decays in rAF and stops on the next pointerdown. Wheel zoom is smoothed through the same rAF. Both are off under reduced motion.
5. `onCategoryInView` (§11.2) is computed at settle only, never per frame.
6. Move the `.tree-*` rules from `app/globals.css` into `components/SkillTree.css`, imported by `SkillTree.tsx`, so lanes B and C never edit the same file.

### 11.6 Build plan: 3 lanes
A and B run in parallel and touch disjoint files. C starts once both are merged; its edits to `Leaderboard.tsx` are a sequential hand-off from A, and it only **consumes** `lib/roadmap.ts` (A owns it, including the `next_tier` type).
Contract (fixed before A and B start): `leaderboard(bigint)` and `activity(bigint,int)` signatures as in §11.1; `roadmap().next_tier` shape as in §11.1 step 4b; `review_submissions` per-row `result` is one of `ok | limit_reached | rejected | already_reviewed` (§11.1 step 4c; signature unchanged, so `types/database.ts` still says `string` and `ReviewQueue.tsx` matches on the literals); `SkillTree` prop `onCategoryInView: (catId: number) => void`, fired once per settle.

**Lane A (DB), branch `slice/v4-a-db`**
- Files:
  - `supabase/migrations/0008_v4_individual_ranks.sql`
  - `supabase/tests/database/{01,03,05,06,08,09}_*.test.sql` plus the new `10_v4.test.sql`
  - `types/database.ts` (regenerated)
  - `supabase/seed.sql`, `supabase/demo-crowd.sql`
  - `components/CaptainTools.tsx` (no group select or export column)
  - `lib/csv.ts`, `scripts/check-csv.mjs`, `supabase/functions/map-columns/index.ts`
  - `lib/roadmap.ts` (`LeaderRow`, `loadLeaderboard`, new `loadActivity`, `NextTier` type on the roadmap result)
  - `components/Leaderboard.tsx`: only the minimal swap to individual rows, so the build stays green
  - the group lines in `docs/fuksipisteet/{ARCHITECTURE-SIMPLE,USER-WORKFLOWS}.md`
- Reviews: run `ecc:database-reviewer` and `ecc:security-reviewer` (RLS widening).
- Acceptance:
  - `supabase db reset` + `supabase test db` all pass;
  - after `npm run demo:crowd`, `leaderboard()` as Demo Fuksi 3 returns 51 rows, none of them staff;
  - the §11.1 cost gate (150 fuksis × ~40 submissions + a second guild, `explain (analyze, buffers)`) is under 50 ms for both RPCs and recorded in PROGRESS.md;
  - Tutor A approves Demo Fuksi 3 in the browser;
  - `npm run build`, `npm run lint` and `node scripts/check-csv.mjs` pass.

**Lane B (tree perf), branch `slice/v4-b-tree`**
- Files: `components/SkillTree.tsx`, the new `components/SkillTree.css`, and only the deletion of the `.tree-*` block from `app/globals.css`.
- Acceptance:
  - the §11.5 trace passes and the before/after numbers are recorded;
  - no visual change at 375 px or on desktop;
  - `onCategoryInView` fires once per settle;
  - `node scripts/check-news.mjs`, build and lint pass.

**Lane C (home + board + game), branch `slice/v4-c-home`, after A and B**
- Files:
  - `components/FuksiHome.tsx` (home page, tree view, category rail)
  - `components/Leaderboard.tsx` (compact/full modes, podium, ▲▼, MVP, FLIP, visibility-aware poll)
  - `components/ProjectorBoard.tsx`
  - `lib/news.ts` + `scripts/check-news.mjs` (`weekStreak` by `created_at`, last-seen rank/total diff)
  - `components/ReviewQueue.tsx` (oldest-first; drop rows whose result is `already_reviewed` and count them, for both "Approve all" and single approve/reject)
  - `app/globals.css` (non-tree rules)
  - `app/layout.tsx` (description copy without "tutor group")
- Acceptance (clicked through in Chrome):
  1. Demo Fuksi 1's home shows "Np to <level>", the `next_tier` chips, category cards, rank and streak.
  2. Tapping Culture flies the tree there and the rail highlights Culture. Panning to another branch moves the highlight. Back returns home.
  3. Tutor approves → within 15 s the phone shows the toast, the new rank and the feed row; the projector updates within 5 s. With the phone's tab closed during the approval, reopening home shows the toast once.
  4. Offline (DevTools) shows the "Offline · updated …" pill with the last data; two tutors approving the same row gives the second one a quiet "already done" count, not an error; tutor X's "Approve all" over 30 rows, one of which tutor Y approved a second earlier, approves the other 29.
  5. No horizontal scroll at 375 px; reduced motion turns every animation off.
  6. The §7 v4 demo runs end to end as a rehearsed Playwright script at 1280x720.
  7. Build, lint and `check-news` pass.
- **Pilot gate** (not needed for the hackathon): the §5 v4 privacy notice is live at `join_guild`.

---
## Appendix F: v4 resolution log
Product-owner decisions (1)–(6) in §11 are fixed. No blocker reversed them; where one touched them, it was resolved by designing around it.

| Proposal | Outcome | Decided by |
|---|---|---|
| Goal card re-derives tier rules from `categories[].min_points` (wrong for per-tier rules, blind to hidden required nodes) | **Accepted.** `roadmap()` returns `next_tier {tier_id, name, points_needed, unmet[], required_missing}` computed with `member_tier`'s predicate; client renders as-is (§11.1 4b, §11.2); pgTAP case with tier-scoped rule + hidden required node | Architect |
| `is_tutor_of` puts no condition on the target (self-review after promotion, staff proofs readable) | **Accepted.** Body requires `tgt.role = 'fuksi'`, `tgt.id <> me.id`, same guild and current season (§11.1 step 1); pgTAP: promoted fuksi can't review own row, tutor can't read other staff rows. Decision (2) holds: every tutor still reviews every fuksi | Security + Database |
| Public board processes personal data with no Art. 13 notice | **Accepted, designed around decision (1).** Names stay public to the guild; §5 adds a notice listing the exact fields, audience (guild + projector) and retention; pilot gate in lane C, not a hackathon gate | Security |
| `week_points` counts adjustments (import day crowns legacy balances, ranks all tie a week ago, penalties read as negative activity) | **Accepted.** One "week" = rolling 7 d, server-stamped, approved submissions only; adjustments count in `total` and the baseline only; matches `activity()`; pgTAP: opening balance today → `week_points = 0`, no MVP | Database + Product + Architect |
| Cost gate sized at 51 fuksis, one guild, plain `explain analyze` | **Accepted.** 150 fuksis × ~40 submissions + second guild, `explain (analyze, buffers)`, < 50 ms for both RPCs, recorded in PROGRESS.md; lateral join shape pinned; partial index only if a Seq Scan shows | Database + Security |
| §7 demo still opens with the map | **Accepted.** v4 demo script (home → scan → approve → rank-up toast + projector FLIP + MVP → keyhole → import/export), rehearsed in Playwright at 1280x720; `demo-v3.2` tag as fallback | Product |
| Rank-up toast only fires between polls, so almost never | **Accepted.** Diff against last-seen rank/total in `localStorage` per member on load and on every poll | Product |
| Streak lost to tutor lag | **Accepted.** Bucket by `submissions.created_at` of now-approved rows; difference from rolling `week_points` documented as intentional | Product + Architect |
| Offline poll failure and shared-queue collisions unspecified | **Accepted.** Keep last data + "Offline · updated …" pill, QR stays local; queue oldest-first, already-reviewed rows dropped silently with a quiet count | Product |
| `total` defined twice | **Accepted.** `leaderboard().total` reads the `progress` view | Architect |
| Lane C / `lib/roadmap.ts` ownership and `onCategoryInView` signature | **Accepted.** A owns `lib/roadmap.ts`, C consumes; contract line in §11.6 | Architect |
| Catalog guard for stray `tutor_group` references in function bodies | **Accepted** (pgTAP in `10_v4`) | Database |
| `activity()` should skip inactive tasks and pin its columns | **Accepted** | Security |
| Unclaimed roster rows on the board? | **Stated:** they appear (they are real guild fuksis with opening balances) | Database |
| Tabular numbers, FLIP on transform/opacity only | **Accepted** | Product |
| Captain-only projector mode (first name + initial) | **Deferred.** Decision (1) says names are fine; add on a real ask | Security (nice-to-have), product owner |
| Rank and `week_points` in the CSV export | **Deferred** until a captain asks | Product (nice-to-have) |
| Shared queue relies on a "silent drop" the server can't support: `review_submissions` raises `not_pending` mid-loop and rolls back the whole batch (with ~20 tutors on one queue, one collision loses 29 of 30 approvals) | **Accepted, makes decision (2) workable.** §11.1 step 4c: same signature, a non-pending row (after lock + re-read, and on the reject path's 0-row update) returns `already_reviewed` and the loop continues; `forbidden` still aborts the batch. Result enum `ok \| limit_reached \| rejected \| already_reviewed` in the §11.6 contract (`ok` kept instead of `awarded`, since the client and pgTAP already match on it). pgTAP: mixed batch of 3 → 2 `ok` + 1 `already_reviewed`, nothing rolled back; `03_flow` `not_pending` cases updated. §11.3 and lane C: client drops exactly the `already_reviewed` rows | Architect |
| Tier predicate has two SQL homes (`member_tier`, `next_tier`) | **Accepted (test now, refactor later).** pgTAP parity check in `10_v4`; `tier_gap()` helper deferred until a third caller (ponytail note in step 4b) | Architect (nice-to-have) |
| "Stamped on the server" is wrong for check-ins (`reviewed_at` = device `scanned_at`, ≤ 24 h old) | **Accepted (wording).** §11.1 "week" now states the timestamp source and accepts the bounded 24 h skew; no code change | Architect (nice-to-have) |
| Record the RLS widening and group removal as an ADR | **Accepted.** ADR-7 in §0 | Architect (nice-to-have) |

## Appendix E: v3.2 (multi-guild)
- `categories.color` (hex CHECK) and `categories.icon` (enum CHECK) replace the hardcoded 6-slot palette, because a guild with 7 tracks would have broken it. Database proposed the colour CHECK in round 4 and Security the icon enum. The Minimalist's ponytail trigger ("when a 2nd guild needs its own look") is now met.
- §10 documents how guild-to-guild variation is handled, plus `bootstrap_guild`.
- Round 7 fixes:
  - `bootstrap_guild` uses a pre-seeded captain roster row plus a one-use fuksi invite, never a role-carrying invite (Security + Architect).
  - The mid-season edit wording now separates snapshotted point values from recomputed category/rules/tiers/required (Database).
  - `import_apply` applies `lower()` to colours before insert (Minimalist + Product + Database).

## Appendix D: Round-4 resolution log (map-driven)
| Proposal | Outcome | Decided by |
|---|---|---|
| P1 ranges | `points_min/max` (not null; jäynä = captain ceiling); CHECK makes wide ranges captain-only; `award_reason` above min | Minimalist (no null), Security (captain-only, reason, pending-only), Database (CHECKs) |
| P2 tiers | `tiers` table + `rules.tier_id` (null = every tier); `member_tier` view | Database + Architect, **over** Minimalist's tiers-as-rules (two row kinds in one table, and per-tier minimums impossible) |
| P3 write-ins | `requires_note`, enforced in RPC; grey pills UI | all |
| P4 secrets | `revealed_at not null default now()` ('infinity' = hidden); `task_visible()` on tasks+events; submit rejects; locked placeholders via `roadmap()` | Database (NULL bug), Security (3 leaks), Product (visible keyholes), **over** Minimalist's reuse of `active` (secret ≠ retired) |
| P5 events→nodes | Accepted; **checkins merged into submissions** (`event_id`, partial unique); `award_task()` single owner; `limit_reached` | Database + Minimalist (merge), Architect (B1 single function), Security + Minimalist (`limit_reached`) |
| P6 roadmap | Stacked category cards on phone, full map on projector, 4 node states; no sort columns (id order). Colour/icon columns were **added later in v3.2** (Appendix E) | Product (UX), Minimalist |
| P7 mandatory | **Reversed** → `tasks.required` | Product + Database (Captain's Quarters 1–2p lets a fuksi skip a mandatory node) |
| Missed | 0-minimum categories skipped on import; duplicate nodes = `max_repeats`; Sitsit worker/attendee = two events; ECTS no photo; Major's joke = captain reviewer; formula-safe CSV; category snapshot on submissions | Architect, Security, Database, Minimalist |

(Earlier appendices A–C are in git history: v2.1 commit `a35a32b`.)
