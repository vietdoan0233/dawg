# Agent rules (Claude Code + Codex)

Spec: `docs/fuksipisteet/SDD.md`; plain-language overview in `docs/fuksipisteet/ARCHITECTURE-SIMPLE.md`. Build only what the spec lists. If something isn't there, ask before adding it. `docs/archive/` holds an abandoned idea, so ignore it.

## Architecture rules (from the SDD, non-negotiable)
- Clients never write tables. Every write goes through a `security definer` RPC in `supabase/migrations/`.
- The service-role key lives only in `supabase/functions/*`. Never put it in Next.js or in `NEXT_PUBLIC_*`.
- Every domain row carries `guild_id` and `season_id`, and FKs are composite. Don't add a table without both.
- Never send names, emails or photos to the AI. The import only sees column headers and masked sample shapes.

## Code style: ponytail
- Before writing code, check in order: does it need to exist? Already in the repo? Stdlib? Supabase/Next built-in? An installed dependency? Only then write it, minimally.
- No ORM: use supabase-js and generated types (`supabase gen types typescript`). No state library, no new abstraction layers.
- Never cut validation, error handling, RLS or privilege checks to save lines.

## Boundaries
- Migration 0001 is frozen after day 0. New migrations come as PRs, and lane A reviews them.
- Secrets go in `.env.local` and Supabase function secrets. Never commit them.
- Use one branch per slice (`slice/<n>-<name>`). Each PR needs a review from another teammate's agent before it merges to `main`.

## Verify before claiming done
- `npm run build`, `npm run lint` and `supabase db reset` + pgTAP pass.
- The slice's SDD §7 deliverables (and any listed Tests) have been run and seen working.
