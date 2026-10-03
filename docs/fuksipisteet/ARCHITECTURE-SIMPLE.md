# Fuksipisteet — the simple version

> Read this first. Details live in [`SDD.md`](SDD.md). If the two ever disagree, **SDD.md wins.**

## What are fuksi points?
A **fuksi** is a first-year student. During the year your guild gives you **points** for taking part in student life: events, volunteering, traditions, guild work. Collect enough by **Wappu** (May 1st) and you become a **teekkari** and get the white cap.

Guilds print this as a **roadmap**. Data Guild's (DG's) roadmap looks like this:

| Track (category) | Need at least | Examples |
|---|---|---|
| ☀️ Mandatory | 6 | 10 ECTS credits, Singing Test, Maturity Test, Wappu ART |
| 🔔 Work | 2 | Work at Sitsit, Work Points |
| 🍷 Party & Orienteering | 0 | Dipoli Party, OtaOrienteering |
| 🏰 Teekkari Culture | 14 | Overalls Adventure, Sew 100 patches, Teekkarijäynä (prank) |
| 🛡️ Guild | 12 | Guild Initiation, FuksiSitsit, Join board meeting |
| ⬡ Other Events | 6 | Other guilds' events + **8 blank slots you fill yourself** |

**Levels:** Teekkari **40p** → Fuksi Doctor **60p** → Double Doctor **80p** → Fuksi Professor **100p**.
**Points:** `[2p]` is fixed. `[1-3p]` means the reviewer picks. 🔒 **Keyholes** are secret nodes revealed later.

**The app is this map, digital.** Each node lights up when you complete it.

## Every guild is different, and that's fine
DG's map is just one example. Other guilds have different tracks, tasks, points, levels and colours. **None of that is code.** It's all rows in the database belonging to that guild and season:
- The captain imports their own sheet, so the app becomes *their* map.
- Changing a task's points later only affects **new** points. Already-earned points stay put.
- Anything the app can't express yet (e.g. "max 10 points from parties") → the captain uses a manual **adjustment** with a reason.
- **Rule for coders: never write `if guild == 'DG'`.** If two guilds need the same new rule, add it as data for everyone.

## The picture
```
   📱 Fuksi phone        📱 Tutor phone       📱 Organizer phone     🖥️ Projector
   (the map, my QR)      (approve queue)      (scanner, works        (full map +
        │                     │                offline)               leaderboard)
        └──────────┬──────────┴─────────┬──────────┘                       │
                   ▼                    ▼                                  ▼
             ┌─────────────────────────────────────────────────────────────────┐
             │                  Next.js website (Vercel)                       │
             │        just screens — shows data, calls functions               │
             └───────────────────────────────┬─────────────────────────────────┘
                                             ▼
             ┌─────────────────────────────────────────────────────────────────┐
             │                    Supabase (EU)                                │
             │   🔐 Login (email code)   🗄️ Database   🖼️ Photo storage        │
             │                                                                 │
             │   ALL changes go through database functions (RPCs).             │
             │   ONE of them — award_task — is the only thing that gives       │
             │   points. Submit, approve and check-in all call it.             │
             │                                                                 │
             │   🤖 import → AI reads the guild's old spreadsheet headers      │
             │   🧹 purge  → deletes photos after 30 days                      │
             └─────────────────────────────────────────────────────────────────┘
```

## The 4 people
| Who | Can do |
|---|---|
| **Fuksi** | See their map, submit nodes (photo/note), show their QR, see their level |
| **Tutor** | Approve their group's submissions (and pick points within a small range), scan QR codes |
| **Organizer** | Scan QR codes at events |
| **Captain** | Everything: nodes, levels, secrets, roles, wide-range points (pranks), import, export |

## The 6 things that happen
1. **Join:** captain posts an invite link → fuksi types their aalto.fi email → gets a 6-digit code → in.
2. **Submit:** fuksi taps a node on their map, adds a photo or note → it shows half-lit (waiting).
3. **Approve:** tutor swipes ✅ / ❌ and picks points if the node is `[1-2p]` → node lights up.
4. **Check-in:** at an event, the organizer scans each fuksi's QR → that event's node lights up. No signal? Saved on the phone and sent later. Failed scans are shown, never silently dropped. There is no event QR: the organizer always scans the fuksi.
5. **Reveal:** captain reveals a secret node → the 🔒 keyhole unlocks on everyone's map.
6. **Export:** captain downloads who reached which level.

## The 8 golden rules (for anyone coding, human or AI)
1. **The website never changes the database directly.** It calls a database function (RPC). Only exception: a fuksi uploads their photo straight to storage, into their own folder.
2. **Only `award_task` gives points.** Never write points anywhere else.
3. **The secret service-role key never goes to the browser.** It lives only in the 2 server functions.
4. **Every row knows its guild and season.** Guilds can't see each other, and last year never mixes with this year.
5. **Secret nodes stay secret.** Fuksis only get "🔒 locked", never the title, until revealed.
6. **Photos are private and deleted after 30 days.** Location data is stripped first. Never ask for grade transcripts.
7. **Invites only make fuksis.** Only the captain can make tutors, organizers or captains. Emails and QR codes are never read from tables.
8. **Simplest thing that works.** No new library or layer unless the plan says so (we call this the Ponytail rule).

## Where things go
```
app/                 screens (Next.js)
  organizer/         check-in scanner  ← Codex teammate
supabase/
  migrations/        database tables + rules. Never edit 0001; add a new migration, lane A reviews it
  functions/         import (AI), purge-photos  ← Codex teammate
docs/fuksipisteet/   SDD.md (full plan), this file
```

## The tables, in one line each
- **guilds / seasons**: which guild, which school year
- **members**: people in a guild this season, and their role
- **categories**: the tracks (Mandatory, Work, Guild, …)
- **tasks**: the map's nodes (points range, how many times, required?, secret?)
- **tiers**: the levels (Teekkari 40, Doctor 60, …)
- **rules**: "at least X points in track Y"
- **events**: real events; each one lights up a node
- **submissions**: every earned or waiting node, whether from a photo or a check-in
- **adjustments**: points the captain adds by hand (or imported from the old sheet)
- **invites**: join links

## Build order
1. **Day 1:** fake users + the real DG map → tap node → approve → node lights up on the projector.
2. Real login + lock everything down.
3. QR check-in (offline).
4. Photos + points picker.
5. Import/export + secret reveal + polish.

Out of time? Steps 1–3 + export are still a full demo.

## Words you'll see
| Word | Means |
|---|---|
| **Node** | One dot on the map = one task |
| **RPC** | A function inside the database that the app calls to change data |
| **RLS** | Database rules that decide which rows each person can *see* |
| **Migration** | A file that creates or changes database tables |
| **Edge Function** | A small server function (we have two: import, purge) |
| **OTP** | The 6-digit login code sent by email |
| **Season** | One school year (Sept → May) |
