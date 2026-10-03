# dawg — Fuksi Companion

Every fuksi is in 30 Telegram chats and still goes to events alone. We fix both: one feed of Aalto events (Kide, Luma, forwarded Telegram posts), ranked to your interests, plus a per-event board to find someone to go with.

- Architecture and build plan: [`docs/SDD.md`](docs/SDD.md)
- Agent rules: [`AGENTS.md`](AGENTS.md)

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
| Lane | Tool | Slices |
|---|---|---|
| A | Claude Code | 1, 2, 6: app, auth, ranking, saves (owns migrations) |
| B | Codex | 3, 4: ingest + normalizer |
| C | Claude Code | 5, 7, 8: Telegram bot, matching, demo |
