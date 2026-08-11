---
id: TASK-565
type: task
role: plan
title: "[Skill:test] check-tree CLI scenarios for plan-terminality (AC-CLOSURE-2 oracle matches zero tests)"
status: archived
priority: critical
phase: "Phase 1: Terminality detector"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
---
Estimate: S
Approach: `lore verify` marked AC-CLOSURE-2 INCONCLUSIVE (not pass) because its oracle command `bunx vitest run packages/lore/tests/integration/cli/check-tree.test.ts -t "plan-terminality"` matches ZERO tests — that file has no plan-terminality scenario. vitest exits 0 on a zero-match `-t` filter (the documented silent-partial-match trap), so only lore's own under-match detector caught it. The detector's unit behavior IS covered (AC-CLOSURE-1, tree-check-service.bun.test.ts); what is NOT covered is the CLI-surface contract that AC-CLOSURE-2 actually asserts.
Write the missing integration scenarios in packages/lore/tests/integration/cli/check-tree.test.ts (vitest; existing file, 7 tests today), named so `-t "plan-terminality"` matches them:
1. `lore status --check-tree` against a corpus containing the drift → nonzero exit, output names the plan slug AND the literal remediation command `lore set <slug> --status archived`.
2. `lore status --check-tree --fix` → the drift is STILL reported afterwards AND the plan doc's status and version are byte-identical before/after (assert both fields — this is the plan's Invariant 1: no repair command may fire the plan-close governance gate).
Follow the existing fixture pattern in that file. ⛔ Throwaway corpus only — never the repo's own `.lore/`.
Source: attested `lore verify` inconclusive verdict at commit dd226fd; spec DD-1; plan Invariant 1.
Dimensions: D-FUNC, D-REGRESSION
Scope-Alt: none — an AC whose oracle matches nothing is an unverified AC.
Covers: AC-CLOSURE-2

AC:
- `bunx vitest run packages/lore/tests/integration/cli/check-tree.test.ts -t "plan-terminality"` → exit 0 with matched count >= 2 (report the number; a zero- or under-match is the exact defect this task exists to fix, so assert the count explicitly).
- The full file still passes: `bunx vitest run packages/lore/tests/integration/cli/check-tree.test.ts` → exit 0, all tests.
- `bun run typecheck` exit 0.
