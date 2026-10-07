# dawg — Fuksipisteet

Guilds track fuksi points (tasks + events → teekkari cap at Wappu) in messy Google Sheets and Telegram photos. Fuksipisteet replaces that: fuksis submit tasks, tutors approve with a swipe, organizers scan QR check-ins even offline, captains import their old sheet and export the cap list.

- **Start here:** [`docs/fuksipisteet/ARCHITECTURE-SIMPLE.md`](docs/fuksipisteet/ARCHITECTURE-SIMPLE.md), the one-page picture
- **Full spec:** [`docs/fuksipisteet/SDD.md`](docs/fuksipisteet/SDD.md), the schema, security and build slices (agreed by a 5-agent architecture review)
- **Agent rules:** [`AGENTS.md`](AGENTS.md)

## Run it locally

**Not a developer?** Follow the step-by-step guide: [`docs/HOW-TO-RUN.md`](docs/HOW-TO-RUN.md).

Needs Git, Node 22+ and Docker Desktop (running).

```bash
git clone <this repo> && cd <repo folder>
npm install
cp .env.example .env.local
npx supabase start      # first run downloads Docker images; prints the API URL and anon key
                        # paste both into .env.local
npx supabase db reset   # builds the schema and loads the Data Guild demo data
npm run demo            # or `npm run dev` for real email login only
```

Open http://localhost:3000 and pick a demo user under "Choose your character". Email login codes are not really sent: read them at http://127.0.0.1:54324. Stop the database with `npx supabase stop`.

## Team setup

**Claude Code**
```
/plugin marketplace add affaan-m/ECC
/plugin install ecc@ecc
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```
Restart Claude Code, then run `/ponytail full`.

**Codex**
```bash
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
npx ecc-universal@2.2.3 install --guided --harness codex
```
Run `codex`, open `/hooks`, and review and trust the hooks. Codex reads `AGENTS.md` automatically.

Both tools need Node on PATH.

## Slice 1 status (walking skeleton)

Run it as in [Run it locally](#run-it-locally). Open `/`, pick a demo user under "Choose your character" (fuksi → skill tree and submit, tutor/captain → review queue, organizer → check-in), and open `/board/<guild id>` for the projector. `npm run gen:types` regenerates `types/database.ts`.

**Every guild is data.** The schema, RPCs, screens and pgTAP tests never name a guild, category, level or rule: they read rows scoped by `(guild_id, season_id)`, so any guild's map renders the same way, and a person in several guilds picks one in the header. `supabase/seed.sql` is only an *optional demo dataset*: Data Guild (DG) plus six demo users with a known password. It refuses to run on a database that already holds data, so use it on local/demo projects only. Category colour and icon live on `categories` (SDD v3.2); the screens render the stored values.

**Scope decisions for Slice 1**
- Self-submission only. `submit_task` keeps `with_member_ids` in its signature but rejects a non-empty array (`group_submit_unsupported`) until group submission is designed (consent, `submitted_by`, skip-at-limit).
- The seed transcribes the whole DG map (see below). Photo and note are optional on every node except the write-ins (note required), pending Data Guild's answer on photo vs check-in. The 2026-27 season dates are demo placeholders.
- `bootstrap_guild` (SDD §10) is assigned to Slice 2 / Lane A, with auth, invites and roles. It is not part of Slice 1. (The SDD §7 text has not been edited; changing it goes through the CLAUDE.md debate process.)

**The DG map is seeded from the real roadmap** (`fuksi point roadmap for Data Guild.jpg`, kept out of the repo): 6 tracks, 4 tiers, the category minimums and 55 nodes. Still placeholders until Data Guild confirms: the 2026-27 season dates, the 8 write-in "+ my own event" points (1p), the Teekkarijäynä ceiling (10p, captain-reviewed), which nodes need a photo vs a check-in, and the 4 secret keyholes (`Secret 1-4`, 3p). Also open: SDD §9 Q1-Q6. Per-role flows: `docs/fuksipisteet/USER-WORKFLOWS.md`.

## Lanes
| Lane | Tool | Owns |
|---|---|---|
| A | Claude Code | Slices 1–2: schema, privileges, RPCs (except `checkin`/`event_roster`), RLS tests, demo login. Reviews every migration PR. |
| B | Claude Code | Fuksi + tutor screens, photos (slice 4), export and polish (slice 5) |
| C | Codex | Check-in (slice 3: `app/organizer/*`, `checkin` + `event_roster` RPC bodies, queue tests), `supabase/functions/*` (import, purge-photos) |
