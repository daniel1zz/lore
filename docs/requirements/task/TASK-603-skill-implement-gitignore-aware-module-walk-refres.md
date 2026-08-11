---
id: TASK-603
type: task
role: plan
title: "[Skill:implement] gitignore-aware module walk + refresh pre-write admission (AC-CTX-9/8 green)"
status: archived
priority: medium
phase: "Phase 4: Hardening"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-088
plan: PLAN-088
---
## Objective
Turn the RED suites green: (F1) make collectContextFacts's module-index walk dot-dir- and gitignore-aware; (F2) make contextRefresh run the claude-md ceiling admission check on the spliced candidate BEFORE writing, refusing loudly on breach. Do NOT edit the test files (they are the contract from the blocking RED task).

## Spec / AC
- Spec: spec-context-verb-family-two-zone-claude-md-anatomy-lore — AC-CTX-9 (walk hygiene), AC-CTX-8 (pre-write admission). AC-CTX-3 idempotency e2e must stay green.
- Root cause + incident: knowledge-retro-context-refresh-module-index-walk-pollutes.

## Design constraints (settled, do not re-plan)
- F1 stays inside the FsReadPort boundary — NO child_process/git spawn. Use the mature `ignore` npm package (spec-compliant .gitignore matcher, pure JS, zero deps) — add to packages/lore deps; read root + per-directory .gitignore via fs.readFile during the walk, layering matchers per directory level. Skip all dot-directories by default. Keep EXCLUDED_DIR_BASENAMES as fallback (non-git repos / no .gitignore).
- F2 reuses the SAME ceiling-check implementation that `lore status --check-claude-md` consumes (service/claude-md-check.ts) — never a second inline size check (SSOT). Breach → non-ok Result naming findings, NO write. `--force` does NOT bypass this (it is init-only, leave it untouched).
- Module invariant: context two-zone modules stay pure — IO enters only via fs-ports; file-writing orchestration stays in flows/context-flow.ts (see packages/lore/src/service/CLAUDE.md).

## Oracles (scoped, run inside worktree)
1. `bunx vitest run packages/lore/tests/unit/service/context-facts.test.ts packages/lore/tests/unit/flows/context-flow.test.ts` — all green, assert matched file count = 2.
2. `bun run typecheck` — exit 0.
3. `cd packages/lore && bun run build && bun test tests/e2e/context-verbs-compiled.bun.test.ts` — AC-CTX-3 regression (build first: stale dist/lore is a known false-oracle vector).
Record each via `lore evidence <this-task> --oracle <test|tsc|e2e> --command "<cmd>" --result pass`.
