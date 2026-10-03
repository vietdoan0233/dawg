# SDD v0.1 — Fuksi Companion (Dawn hackathon)

> One line: every fuksi is in 30 Telegram chats and still goes to events alone. We fix both.

Feed this file to ECC: `/ecc:orch-build-mvp docs/SDD.md`

## 1. Locked decisions

| Area | Decision | Why |
|---|---|---|
| Frontend | Next.js (App Router) + Tailwind, deployed on Vercel | One deploy target, free tier |
| Backend | Supabase: Postgres, Auth, RLS, Edge Functions, Realtime | No custom server to run |
| Auth | Supabase magic link, **`@aalto.fi` emails only** | Gives matching a trust signal; no passwords |
| Scrapers | Python scripts run by **GitHub Actions cron** (every 30 min) | Kide scraper already exists; no worker hosting |
| Telegram | **Forward-to-bot** (Bot API webhook → Edge Function). **No userbot.** | Opt-in, GDPR-safe, no ban risk, live-demoable |
| LLM | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) with JSON schema output; vision for screenshots | Fast/cheap, good enough for extraction |
| Ranking | SQL tag-overlap score. No embeddings, no ML. | Ponytail: doesn't need to exist yet |
| Calendar | `.ics` export per event + "my saved" feed. No conflict engine. | Native calendars already do this |

Out of scope for MVP: Instagram scraping, native app, push notifications, chat inside the app.

## 2. System overview

```
 Kide scraper (py) ─┐
 Luma (iCal/py)  ───┼─► raw_items ──(DB webhook on INSERT)──► normalize  ──► events
 Telegram bot  ─────┘   (append-only)                         Edge Fn          │  ▲
  (forwards, screenshots)                                     (Claude Haiku)   │  │ dedup/merge
                                                                               ▼  │
                         Next.js app ◄──── Supabase (RLS) ────► saves, match_posts, waves
                         feed / onboarding / event page / matching board
```

**Key idea: every source only writes `raw_items`.** One normalizer turns raw items into events, so adding a source means writing an inserter and nothing else.

## 3. Components

### 3.1 Ingestion
- **Kide** — the existing scraper. Change only its output: insert into `raw_items` (`source='kide'`, `payload` = scraped JSON, `source_url`). Kide data is already structured, so the normalizer may map fields directly and skip the LLM.
- **Luma** — public calendar pages (Aalto Startup Center, Junction, AaltoES, etc.). First check whether the calendar exposes an iCal feed (**verify**). If it does, parse it with the `icalendar` library. If not, parse the page's embedded JSON. Same inserter.
- **Telegram bot** — a regular bot created with @BotFather. Its webhook points to the `telegram-webhook` Edge Function, which:
  1. checks the `X-Telegram-Bot-Api-Secret-Token` header,
  2. stores text and caption, `forward_origin` (the chat it was forwarded from), and the file id of any photo,
  3. inserts a `raw_items` row and replies "Got it, parsing…", then "Added: *title*, date [link]" once the event exists.
  Guild boards can also add the bot to their *announcement channels* (opt-in) so it receives `channel_post` updates.

### 3.2 Normalizer (`normalize` Edge Function)
- Triggered by a database webhook on `raw_items` INSERT. Idempotent: it skips rows whose `status != 'pending'`.
- Sends one Claude call per item, with structured output matching:
  `{ is_event: bool, title, starts_at (ISO, Europe/Helsinki), ends_at?, location, organizer?, price?, language?, tags: enum[], summary (≤200 chars), signup_url? }`
- Tags come from a fixed enum so ranking is just set overlap: `party, sitsit, sports, startup, hackathon, career, tech, art, music, culture, guild, international, free_food, outdoors, wellbeing`.
- If `is_event = false`, sets `status='rejected'`.
- **Dedup:** look for an existing event on the same day with `similarity(title) > 0.5` (`pg_trgm`). If one exists, attach this item as another `event_sources` row. If not, insert a new event.
- On failure, sets `status='error'` and stores the error. A retry is just resetting the row to `pending`.

### 3.3 App (Next.js)
| Route | Purpose |
|---|---|
| `/` | Landing page + login |
| `/onboarding` | 3 questions: programme/school, interest tags (multi-select from the enum), "what are you looking for" (friends / teammates / just events). Also an optional Telegram handle. |
| `/feed` | Upcoming events ranked by `score`, filter chips by tag, "N fuksis looking for company" badge |
| `/events/[id]` | Details, all sources, Save, Add to calendar (.ics), **matching board** |
| `/me` | Saved events, profile, `.ics` subscribe link |

### 3.4 Matching (the differentiator)
- Matching is **per event**, so it works with as few as 2 users.
- On an event page, a user posts `I'm going, looking for: [someone to go with | teammates]` plus a short note. They can see the others' posts (first name, programme, tags, note).
- **Wave → mutual reveal:** you wave at a post. When both people have waved, each sees the other's Telegram handle. Until then, no contact info is shown. Enforced in RLS, not the UI.
- Realtime subscription on `match_posts` for the event, so new posts appear live during the demo.

## 4. Data model (Postgres)

```sql
create extension if not exists pg_trgm;

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  first_name text not null,
  programme text,
  interests text[] not null default '{}',
  looking_for text check (looking_for in ('friends','teammates','events')),
  telegram_handle text,           -- revealed only on mutual wave
  created_at timestamptz default now()
);

create table raw_items (
  id bigint generated always as identity primary key,
  source text not null check (source in ('kide','luma','telegram')),
  source_url text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','done','rejected','error')),
  error text,
  event_id bigint,
  created_at timestamptz default now()
);

create table events (
  id bigint generated always as identity primary key,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  organizer text,
  price text,
  summary text,
  tags text[] not null default '{}',
  signup_url text,
  created_at timestamptz default now()
);
create index on events (starts_at);
create index on events using gin (title gin_trgm_ops);

create table event_sources (
  event_id bigint references events on delete cascade,
  raw_item_id bigint references raw_items,
  source text not null,
  url text,
  primary key (event_id, raw_item_id)
);

create table saves (
  user_id uuid references profiles on delete cascade,
  event_id bigint references events on delete cascade,
  primary key (user_id, event_id)
);

create table match_posts (
  id bigint generated always as identity primary key,
  event_id bigint references events on delete cascade,
  user_id uuid references profiles on delete cascade,
  intent text not null check (intent in ('company','teammates')),
  note text check (length(note) <= 280),
  created_at timestamptz default now(),
  unique (event_id, user_id)
);

create table waves (
  from_user uuid references profiles on delete cascade,
  to_post bigint references match_posts on delete cascade,
  created_at timestamptz default now(),
  primary key (from_user, to_post)
);
```

**Ranking** is a SQL function `feed(user_id)`, called through RPC:
`score = cardinality(event.tags ∩ profile.interests) * 2 + (match_posts count > 0 ? 1 : 0)`, ordered by `score desc, starts_at`, for upcoming events only.

**RLS summary**
- `events`, `event_sources`: readable by any authenticated user. Writes come only from the service role (the normalizer).
- `raw_items`: service role only.
- `profiles`: users read and update their own row. A view `public_profiles` exposes `first_name, programme, interests` (no handle).
- `match_posts`: readable by authenticated users. Users can insert and delete only their own posts.
- `waves`: users insert their own and can read waves they sent or received.
- `reveal_handle(post_id)`: a security definer function that returns the handle **only if waves exist in both directions**.

## 5. Security and privacy (must pass ECC `security-reviewer`)
- The Telegram webhook verifies the secret token. Its Edge Function uses the service role key, which is **never** shipped to the client.
- The Anthropic key lives only in Edge Function secrets.
- Login is restricted to `@aalto.fi`, enforced server-side with an Auth hook, not just in the UI.
- We only store messages that users actively forward. A privacy note on `/` covers this, and users can delete their profile, which cascades.
- LLM output is validated against the schema before insert. We never render it as HTML.

## 6. Build slices (vertical, in order)

Each slice is end-to-end and demoable. ECC Gate 2 runs after each one.

1. **Seeded feed**: Supabase schema plus ~20 hand-seeded real October events, and a `/feed` page that lists them. *Done when the deployed URL shows events.*
2. **Auth + onboarding + ranking**: magic link limited to `@aalto.fi`, the 3-question onboarding, and the `feed()` RPC. *Done when two different profiles get different orderings.*
3. **Normalizer + Luma**: `raw_items` → `normalize` → `events` with dedup, plus a Luma inserter running on GitHub Actions cron. *Done when a new Luma event appears without manual work.*
4. **Kide**: plug the existing scraper into `raw_items`. *Done when Kide and Luma copies of the same event merge into one.*
5. **Telegram bot**: forwarded text and screenshots become events, and the bot replies with a link. *Done when the live demo loop takes under 10 seconds.*
6. **Saves + .ics export**: save button, `/me`, single-event `.ics`, and a subscribe feed.
7. **Matching**: posts, waves, mutual reveal, realtime updates. *Done when two browsers can match on one event.*
8. **Demo polish**: seeded fake fuksi profiles for matching, empty states, mobile layout.

Fallback if time is short: slices 1, 2, 5 and 7 make a complete pitch. Kide, Luma and the .ics export can be cut.

## 7. Repo layout
```
/app                Next.js routes
/lib                supabase client, types (generated: `supabase gen types`)
/supabase
  /migrations       SQL above, one file per slice
  /functions
    normalize/
    telegram-webhook/
  seed.sql
/ingest             python: kide.py, luma.py, common.py (insert raw_items)
/.github/workflows  ingest.yml (cron)
/docs/SDD.md        this file
```

## 8. Dev workflow (ECC + Ponytail)

**Setup (once per teammate):** see the README. Claude Code users install both plugins. The Codex user installs the Codex versions. Everyone reads `AGENTS.md`.

**Loop per slice:**
1. `/ecc:orch-build-mvp docs/SDD.md`: reads this file, proposes the slice plan (**Gate 1**), and scaffolds slice 1.
2. For each following slice, run `/ecc:orch-add-feature "<slice name from §6>"`.
3. Reviews:
   - `database-reviewer` on every migration (RLS especially),
   - `security-reviewer` on slices 2, 5 and 7 (auth, webhook, contact reveal),
   - `/ponytail-review` before each commit to cut over-engineering.
4. Bugs: `/ecc:orch-fix-defect`. Build breaks: `/ecc:build-fix`.

**Rules for agents:**
- Ponytail's ladder applies: use a Supabase or Next built-in before writing code, and an installed dependency before adding a new one.
- No ORM: use supabase-js plus generated types. No state library: use server components and `useState`.
- Don't add abstraction layers "for future sources". The `raw_items` table already is that abstraction.

**Team lanes (3 people):**
- **A (Claude Code)**: slices 1, 2 and 6. App, auth, ranking, saves. Owns `supabase/migrations`.
- **B (Codex)**: slices 3 and 4. Python ingest and the normalizer. This lane is self-contained (`/ingest`, `supabase/functions/normalize`), which suits Codex's async task style.
- **C (Claude Code)**: slices 5, 7 and 8. Telegram bot, matching, demo seed.

Contract between lanes: the §4 schema plus the `raw_items.payload` shape. Lock both in the first hour. Only lane A edits migrations; the others request changes. Use one branch per slice (`slice/3-luma`), and PR into `main`, reviewed by another teammate's agent (`/code-review <PR#>`).

## 9. Open questions
- Does Luma expose iCal for the calendars we need? This decides how slice 3 parses Luma.
- What language and output format is the Kide scraper? This decides how slice 4 plugs it in.
