---
id: TASK-580
type: task
role: plan
title: "[Skill:test] F5a source-run-guard test must control its own precondition"
status: archived
priority: critical
phase: "Phase 3: CLI & delivery"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-578, type: blocks}
---
Estimate: S
Approach: `packages/lore/tests/integration/dashboard-command.bun.test.ts`'s "source-run guard (AC-F5A-5)" case asserts packaged-mode behavior WHEN NO BUILT ASSETS EXIST, but it does not control that precondition — it silently inherits whatever ambient state the checkout has. On a checkout where `packages/lore/src/generated/dashboard-assets.ts` exists (any checkout where `bun run build` has been run), the CLI correctly finds assets, starts normally, exits 0, and the assertion `exitCode != 0` fails. It only passed in the implementer's worktree because that file was manually deleted first.
Fix at root cause: the test must force the unavailable-assets condition deterministically, independent of ambient build state. Preferred mechanism: an explicit env seam consumed by the CLI's loader call (e.g. `LORE_DASHBOARD_ASSETS_FIXTURE=0` / a dedicated force-unavailable var) so the guard path is exercised regardless of whether the generated module exists; alternative: point the loader at a non-existent module path via the existing `modulePath` seam. Do NOT "fix" this by deleting the generated file from within the test — mutating shared build artifacts is order-dependent and would break concurrently running suites.
Source: attested `lore verify` failure on main after the T3 merge (AC-F5A-5, exit 1, `expect(exitCode).not.toBe(0)` received 0, with `packages/lore/src/generated/dashboard-assets.ts` present); spec DD-5.
Dimensions: D-FUNC, D-REGRESSION
Scope-Alt: none — an environment-dependent oracle is a false oracle in both directions and must not ship.
Covers: AC-F5A-5

AC:
- Given a checkout WHERE the generated dashboard-assets module EXISTS, When `bun test packages/lore/tests/integration/dashboard-command.bun.test.ts -t "source-run guard"` runs, Then exit 0 with matched-count 1 (the guard path is exercised via the forced precondition, not ambient absence).
- Given a checkout where that module is ABSENT, When the same command runs, Then exit 0 as well — the test result MUST be identical in both environments (run it both ways and record both exit codes in evidence; a test that passes only one way has not been fixed).
- Given the CLI source, When the force-unavailable seam is added, Then it is test-only in effect and cannot make a real user's packaged launch silently fail (document the guard in the task evidence note).
