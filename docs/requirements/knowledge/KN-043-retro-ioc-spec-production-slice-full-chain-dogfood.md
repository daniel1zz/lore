---
id: KN-043
type: knowledge
role: knowledge
title: "Retro — IoC spec-production slice (full-chain dogfood + worktree/env learnings)"
status: draft
priority: medium
created: 2026-07-08
updated: 2026-07-08
tags: [retro, ioc-slice, dogfood, worktree, learnings]
links:
  - {id: PLAN-024, type: informs}
---
Session retro — building the IoC spec-production vertical slice, managed end-to-end through lore itself.

## What shipped
Full chain, all in lore: ADR (paradigm anchor) → tech-spec → plan (5 invariants / 4 risks) → 10 tasks (TDD-paired) → 6 feature commits (`cf22194`→`43bc144`) → `lore verify` self-acceptance (2 ACs `⚑✔ attested`). The control-inversion loop (block → feed → retry-pass → create → block → add-AC → pass) is green end-to-end (e2e `spec-loop-e2e.bun.test.ts`), full suite 673 bun + 2890 vitest, `.lore` zero pollution.

## Learnings (carry-forward)
1. **Full-chain dogfood works.** Governing our own build through lore (ADR→spec→plan→task→verify) is self-consistent and leaves a queryable trail. The paradigm's own value (versioned, traceable process) showed up immediately.
2. **Worktree isolation did NOT engage in this environment.** `git worktree list` showed only the main checkout; every implementer committed directly to `main`. No remote → `git pull --rebase` N/A. Lesson: verify isolation with `git worktree list` before dispatching; when it's absent, treat ALL tasks as mutually exclusive and dispatch strictly serially (we did — no collisions).
3. **`.lore/lore.db` is gitignored → worktree agents can't see plan/task data.** Bundles MUST be self-contained (interface contracts + AC + file anchors inline); never rely on a subagent querying lore. Main agent owns all lore state updates.
4. **Environment trap: a real `claude` binary on `$PATH` hangs judge-advisory tests ~5s (waiting on stdin).** Three agents independently hit it; fix = point `ai.provider` at a nonexistent binary (`ghost-ai-binary-not-installed-xyz`, the AC-AI-5 idiom). Bake this into any AI-provider test from the start.
5. **verify dogfood succeeded.** SPEC-039's attested runner executed the slice's own script-ACs; result derived from exit code, not caller-asserted. This is the loop validating itself.
6. **Two-layer gate held.** Deterministic zone hard-blocks via exit code; probabilistic judge writes stderr-only advisory, never touches exit (INV2 has a load-bearing test assertion). Structurally guaranteed — exit finalized before advisory emitted.

## Debt / follow-ups
- **SSOT nit:** `WRITE_SPEC_RULE_TITLE` is duplicated in `scripts/seed-write-spec-rule.ts` and `cli/commands/gate.ts` because `scripts/` sits outside `packages/lore/tsconfig.tests.json` rootDir (static import → TS6059). Lift the constant into `@lore/core`.
- **G2 Bash-path parsing** stays regex-based (R2); MCP structured path is sturdier. Fine for the slice; revisit if false-negatives appear.
- Horizontal scale-out (other doc types' gates, full P1 prompt/skill first-class types, P2 state machine) per the ADR's P1–P4.
- `.claude/settings.json` now wires the PreToolUse gate — active next session. First real-session firing is the true acceptance of "active feeding".
