# Fuksipisteet — the simple version

> Read this first. Details live in [`SDD.md`](SDD.md). If the two ever disagree, **SDD.md wins.**

## What it is
Guilds give fuksis points for doing tasks and going to events. Enough points = teekkari cap at Wappu.
Today that's a messy Google Sheet. We make it an app.

## The picture
```
   📱 Fuksi phone        📱 Tutor phone       📱 Organizer phone     🖥️ Projector
        │                     │                    │ (works offline,       │
        │                     │                    │  syncs later)         │
        └──────────┬──────────┴─────────┬──────────┘                       │
                   ▼                    ▼                                  ▼
             ┌─────────────────────────────────────────────────────────────────┐
             │                  Next.js website (Vercel)                       │
             │        just screens — shows data, calls functions               │
             └───────────────────────────────┬─────────────────────────────────┘
                                             ▼
             ┌─────────────────────────────────────────────────────────────────┐
             │                    Supabase (EU)                                │
             │                                                                 │
             │   🔐 Login (email code)   🗄️ Database   🖼️ Photo storage        │
             │                                                                 │
             │   The database has "functions" (RPCs). ALL changes go through   │
             │   them. They check: who are you? are you allowed? is it valid?  │
             │                                                                 │
             │   🤖 import  → AI reads the guild's old spreadsheet headers     │
             │   🧹 purge   → deletes photos after 30 days                     │
             └─────────────────────────────────────────────────────────────────┘
```

## The 4 people
| Who | Can do |
|---|---|
| **Fuksi** | Submit tasks (with photo), show their QR code, see their points |
| **Tutor** | Approve their group's submissions, scan QR codes at events |
| **Organizer** | Scan QR codes at events |
| **Captain** | Everything: tasks, rules, roles, import, export |

## The 5 things that happen
1. **Join:** captain posts an invite link → fuksi types their aalto.fi email → gets a 6-digit code → in.
2. **Submit:** fuksi picks a task, adds a photo → it waits for approval.
3. **Approve:** tutor swipes ✅ / ❌ (or "approve all") → points added.
4. **Check-in:** at an event, organizer scans each fuksi's QR → points added. No signal? Saved on the phone, sent later. Never the other way round: there is no event QR. Open the scanner page before going to the venue. Failed scans are shown, never silently dropped.
5. **Export:** captain downloads a spreadsheet of who earned the cap.

## The 7 golden rules (for anyone coding, human or AI)
1. **The website never changes the database directly.** It calls a database function (RPC). The function checks permissions. Only exception: a fuksi uploads their photo straight to storage, into their own folder.
2. **The secret service-role key never goes to the browser.** It lives only in the 2 server functions.
3. **Every row knows its guild and season.** Guilds can't see each other's data, and last year's data can't mix with this year's.
4. **Points are saved at approval or check-in.** Changing a task's or event's points later doesn't change past points. Event points come only from check-ins.
5. **Photos are private and deleted after 30 days.** Location data is stripped before upload.
6. **Simplest thing that works.** No new library or layer unless the plan says so (we call this the Ponytail rule).
7. **Invites only make fuksis.** Only the captain can make someone a tutor, organizer or captain. Emails and QR codes are never read from tables: use `my_code()` and `captain_roster()`. The leaderboard shows tutor-group totals only, never individual fuksis.

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
- **categories**: point types (sports, culture, …)
- **tasks**: things you can do for points
- **events**: things you can attend for points
- **rules**: "you need X points (of category Y) for the cap"
- **submissions**: "I did this task", waiting or approved
- **checkins**: "I was at this event"
- **adjustments**: points the captain adds by hand (or imported from the old sheet)
- **invites**: join links

## Build order
1. **Day 1:** fake users → submit → approve → points bar → leaderboard. Demo-able.
2. Real login + lock everything down.
3. QR check-in (offline).
4. Photos.
5. Spreadsheet import/export + polish.

Out of time? Steps 1–3 + export are still a full demo.

## Words you'll see
| Word | Means |
|---|---|
| **RPC** | A function inside the database that the app calls to change data |
| **RLS** | Database rules that decide which rows each person can *see* |
| **Migration** | A file that creates or changes database tables |
| **Edge Function** | A small server function (we have two: import, purge) |
| **OTP** | The 6-digit login code sent by email |
| **Season** | One school year (Sept → May) |
