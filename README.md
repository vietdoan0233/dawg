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

## Slice 1 status (walking skeleton)

Run: `cp .env.example .env.local`, `supabase start` (paste the printed URL + anon key into `.env.local`, and uncomment `NEXT_PUBLIC_DEMO=1` for the demo login), `supabase db reset`, `npm install`, `npm run dev`. Open `/`, pick a demo user in "Log in as" (fuksi → map and submit, tutor/captain → approve queue), and open `/board/<guild id>` for the projector. `npm run gen:types` regenerates `types/database.ts`.

**Every guild is data.** The schema, RPCs, screens and pgTAP tests never name a guild, category, level or rule: they read rows scoped by `(guild_id, season_id)`, so any guild's map renders the same way, and a person in several guilds picks one in the header. `supabase/seed.sql` is only an *optional demo dataset*: Data Guild (DG) plus six demo users with a known password. It refuses to run on a database that already holds data, so use it on local/demo projects only. Category colour and icon live on `categories` (SDD v3.2); the screens render the stored values.

**Scope decisions for Slice 1**
- Self-submission only. `submit_task` keeps `with_member_ids` in its signature but rejects a non-empty array (`group_submit_unsupported`) until group submission is designed (consent, `submitted_by`, skip-at-limit).
- The one seeded node, *Work at Sitsit* (2p, Work), is a **temporary placeholder**: its title, category and points are inferred from the docs, not confirmed by Data Guild, and it has `requires_photo = false` only because photo capture is slice 4. The 2026-27 season dates are demo placeholders pending Data Guild.
- `bootstrap_guild` (SDD §10) is assigned to Slice 2 / Lane A, with auth, invites and roles. It is not part of Slice 1. (The SDD §7 text has not been edited; changing it goes through the CLAUDE.md debate process.)

**The real DG map is not seeded.** `fuksi point roadmap for Data Guild.jpg` is not in the repo, so the demo dataset holds only what the docs state: the 6 categories (default colours and icons), the 4 tiers, the category minimums (Party & Orienteering is `[0]`, so no rule) and the placeholder node. Still needed, per node: category, exact points or range, `max_repeats`, `required`, `reviewer`, `requires_photo`, `requires_note` and whether it is secret. That covers every named example (Singing Test, Maturity Test, Wappu ART, 10 ECTS credits, Work Points, Dipoli Party, OtaOrienteering, Overalls Adventure, Sew 100 patches, Teekkarijäynä, Guild Initiation, FuksiSitsit, Join board meeting), the 8 write-in slots, the Sitsit Culture 1p node and the keyholes. Also needed: real season dates, the Sitsit event time, and answers to SDD §9 Q1-Q6.

## Lanes
| Lane | Tool | Owns |
|---|---|---|
| A | Claude Code | Slices 1–2: schema, privileges, RPCs (except `checkin`/`event_roster`), RLS tests, demo login. Reviews every migration PR. |
| B | Claude Code | Fuksi + tutor screens, photos (slice 4), export and polish (slice 5) |
| C | Codex | Check-in (slice 3: `app/organizer/*`, `checkin` + `event_roster` RPC bodies, queue tests), `supabase/functions/*` (import, purge-photos) |
