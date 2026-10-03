# Agent rules (Claude Code + Codex)

Spec: `docs/SDD.md`. Build only what it lists; if something isn't there, ask before adding it.

## Code style: ponytail
- Before writing code, check in order: does it need to exist? Already in the repo? Stdlib? Supabase/Next built-in? An installed dependency? Only then write it, minimally.
- No ORM: use supabase-js and generated types (`supabase gen types typescript`).
- No state library and no new abstraction layers. `raw_items` is the only extension point.
- Never cut validation, error handling, RLS or auth checks to save lines.

## Boundaries
- Schema changes go only in `supabase/migrations/`, and only lane A edits them. Everyone else requests changes in the PR.
- Keep secrets in `.env.local` and Supabase function secrets. Never commit them. Never put the service role key in client code.
- Use one branch per slice (`slice/<n>-<name>`). Each PR needs a review from another teammate's agent before it merges to `main`.

## Verify before claiming done
- `npm run build` and `npm run lint` pass.
- The slice's "Done when" check from SDD §6 has been run and seen working.
- Migrations touching RLS have been reviewed by `database-reviewer` (Claude) or an equivalent review prompt (Codex).
