# Fuksipisteet implementation progress

Updated: 2026-10-03

## Current snapshot

- Working branch: `slice/1-walking-skeleton`.
- Base: `cc0d3d1` — SDD v3.2 and multi-guild architecture update from `origin/main`.
- Slice 1 implementation is still local and uncommitted. The branch currently points at the base commit; most implementation files are untracked, with `README.md` and `.gitignore` modified.
- This is a demo walking skeleton, not a complete or production-ready Data Guild rollout.

## Implemented

- Next.js app with demo-user login, member/guild selection, fuksi roadmap, tutor/captain review queue, and projector map with a tutor-group leaderboard.
- Supabase migration `0001_init.sql` with the v3 schema, RLS and explicit grants, security-definer RPCs, progress/tier views, and `award_task` as the points-awarding path.
- Category colour and icon stored in each category row and rendered by the app, as required by SDD v3.2.
- Optional demo seed guarded against non-empty databases. It contains six categories, four tiers, category rules, six demo members, and one explicitly labelled placeholder task.
- Multi-guild selection and tests using two guilds with different track structures.
- Five SQL test files: privileges, award flow, app flow, category appearance, and multi-guild isolation.
- `submit_task` keeps the `with_member_ids` parameter for compatibility but rejects non-empty values with `group_submit_unsupported`.
- `bootstrap_guild` is assigned in the README to Slice 2 / Lane A; it is not implemented in Slice 1.

## Architecture status

The implementation follows the main v3.2 architecture: guild and season scoped data, composite relationships, database RPCs for writes, RLS, data-driven category appearance, and no guild-specific logic in the app or schema.

There are limited, explicit deviations or deferrals; this is not a general architecture pivot:

- **Group submission:** the SDD still describes `with_member_ids` behavior, but Slice 1 rejects group submissions. `submitted_by`, consent handling, and skip-at-limit behavior are deferred. Record and debate this deferral in the SDD before treating it as an accepted long-term contract.
- **Demo data:** the only task is an inferred “Work at Sitsit” 2-point Work node. Its title, category, points, and `requires_photo = false` are placeholders, not confirmed DG policy. Season dates are placeholders too. The actual roadmap image/data is absent.
- **Tier rules:** the demo category minimums have `tier_id = null`, so they apply to every tier. Whether higher tiers need additional category minimums remains open (SDD §9 Q3).
- **Projector:** it currently shows the logged-in member’s roadmap state. Confirm whether that is intended for a shared projector or if it should show a guild-wide view.
- **Guild onboarding:** `bootstrap_guild` is scheduled in the README for Slice 2 / Lane A, while SDD §10 describes its behavior. Confirm the schedule before that slice begins.

## Inputs still needed

For the real DG seed, provide the roadmap image or a node-by-node data source with category, title, points/range, repeat limit, required/reviewer settings, photo/note requirements, and secret status. Also confirm:

- Actual season start/end dates and the Sitsit event time.
- Whether “Work at Sitsit” is the 2-point Work node.
- SDD §9 questions: mandatory-task semantics, whether 40 points is required for the cap, higher-tier category minimums, secret-node reveal rules, jäynä reviewer/point ceiling, and permission to reproduce the roadmap artwork.
- Whether the projector should show an individual member’s states or a guild-wide view.

## Verification

Checks rerun for this status report:

- `npm run lint` — passed.
- `npm run build` — passed. The sandbox initially blocked the TypeScript worker (`spawn EPERM`); the successful rerun completed TypeScript checking and generated the app routes.
- Source scan of `app/`, `components/`, and `lib/` — no service-role key reference found.

Claude also reported:

- Generated Supabase types match the scratch schema.
- 136 SQL assertions pass against scratch Postgres 18 using a pgTAP shim.
- API, UI, multi-guild, secret-node, and seed-guard checks pass using local stand-ins.

Still unverified on the real stack: `supabase db reset`, real pgTAP, real GoTrue login, and the actual Supabase default-privilege environment. Docker is unavailable in this workspace, so those checks could not be run here. The API smoke tests used a proxy in place of GoTrue; the pgTAP checks used a shim.

## Push readiness and next steps

**Not ready to push as a completed Slice 1.** The implementation is uncommitted, the real DG map is missing, and the repository’s required Supabase reset/pgTAP verification has not run on the actual stack. Before a public push, the repo guidance also calls for Ponytail/code review before commit and an open-source sanitizer before push; the Claude report does not include results for those reviews.

Recommended order:

1. Keep the current seed explicitly demo-only; obtain the real roadmap and policy answers before claiming DG data is complete.
2. Decide and document the group-submission deferral and projector behavior. Use the five architecture debaters before changing the SDD or RPC contract.
3. Run `supabase db reset` and real pgTAP on a Docker-enabled Supabase environment, then verify login against real GoTrue and Supabase privileges.
4. Complete the required migration/code reviews and open-source sanitizer, then commit and push the slice branch.
