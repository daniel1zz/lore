---
id: TASK-602
type: task
role: plan
title: "[Skill:implement] plumb configured memory-file budgets into context verbs (AC-CTX-8 config gap)"
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
Close the AC-CTX-8 config-plumbing gap: `runContextRefresh` (and `runContextInit` if it shares the path) evaluates the ceiling admission against `resolveMemoryFileBudgets(undefined)` — schema DEFAULTS (root 300L/30720B) — ignoring the repo's `.lore/config.yaml` override (`context.memory_files.root: 220L/24576B` in this repo). AC-CTX-8 requires the SAME budget source as `lore status --check-claude-md`, which resolves from config. Live evidence: on this repo the refusal message cites "ceiling of 300 / 30720" while `lore status --check-claude-md` enforces 220/24576.

## Fix shape (settled)
Thread resolved budgets (or the loaded config) from the CLI adapter (`adapters/cli/commands/context.ts`) into the flow deps instead of calling `resolveMemoryFileBudgets(undefined)` inside the flow — mirror however `status.ts` resolves them (SSOT: one resolution locus per invocation, config-aware). Both call sites in context-flow.ts (`:237` facts, `:288` admission) must use the threaded value. No behavior change when no override exists (defaults resolve identically).

## RED-first (write the failing test BEFORE the fix, in context-flow.test.ts)
- NEGATIVE: with an injected budgets/config override tightening root max_lines below the spliced candidate's size (while staying under the DEFAULT 300), refresh must refuse — fails today because the override is ignored.
- REGRESSION: existing AC-CTX-8 cases (default budgets) stay green unchanged.

## Oracles (scoped, worktree)
1. `bunx vitest run packages/lore/tests/unit/flows/context-flow.test.ts packages/lore/tests/unit/service/context-facts.test.ts` — all green, Test Files 2.
2. `bun run typecheck` — exit 0.
3. `cd packages/lore && bun run build && bun test tests/e2e/context-verbs-compiled.bun.test.ts` — AC-CTX-3 stays green.
4. End-to-end on a temp repo fixture is NOT required; the main checkout live check happens post-merge by the orchestrator.
Record via lore evidence (test/tsc/e2e), then release.
