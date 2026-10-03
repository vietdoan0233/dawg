@AGENTS.md

## Claude Code specifics (ECC + Ponytail)
- First build: `/ecc:orch-build-mvp docs/fuksipisteet/SDD.md`. After that, run `/ecc:orch-add-feature "<slice from SDD §7>"` for each slice.
- Every migration: run the `ecc:database-reviewer` agent. Slices 2–4: run the `ecc:security-reviewer` agent.
- Before each commit: `/ponytail-review`, then `/code-review`. Bugs: `/ecc:orch-fix-defect`. Build breaks: `/ecc:build-fix`.
- Before pushing a public change: run the `ecc:opensource-sanitizer` agent, because the repo is public.
- If ECC GateGuard prompts slow you down: `ECC_GATEGUARD=off claude`.
