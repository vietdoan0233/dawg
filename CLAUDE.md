@AGENTS.md

## Claude Code specifics
- First build: `/ecc:orch-build-mvp docs/SDD.md`. After that, run `/ecc:orch-add-feature "<slice from SDD §6>"` for each slice.
- Before committing: `/ponytail-review`, then `/code-review`. Run the `security-reviewer` agent on slices 2, 5 and 7.
- If ECC GateGuard prompts slow you down: `ECC_GATEGUARD=off claude`.
