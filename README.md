# dawg — Fuksipisteet

Guilds track fuksi points (tasks + events → teekkari cap at Wappu) in messy Google Sheets and Telegram photos. Fuksipisteet replaces that: fuksis submit tasks, tutors approve with a swipe, organizers scan QR check-ins even offline, captains import their old sheet and export the cap list.

- **Start here:** [`docs/fuksipisteet/ARCHITECTURE-SIMPLE.md`](docs/fuksipisteet/ARCHITECTURE-SIMPLE.md), the one-page picture
- **Full spec:** [`docs/fuksipisteet/SDD.md`](docs/fuksipisteet/SDD.md), the schema, security and build slices (agreed by a 5-agent architecture review)
- **Agent rules:** [`AGENTS.md`](AGENTS.md)

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

## Lanes
| Lane | Tool | Owns |
|---|---|---|
| A | Claude Code | Slices 1–2: schema, privileges, RPCs (except `checkin`/`event_roster`), RLS tests, demo login. Reviews every migration PR. |
| B | Claude Code | Fuksi + tutor screens, photos (slice 4), export and polish (slice 5) |
| C | Codex | Check-in (slice 3: `app/organizer/*`, `checkin` + `event_roster` RPC bodies, queue tests), `supabase/functions/*` (import, purge-photos) |
