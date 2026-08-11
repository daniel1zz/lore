---
id: TASK-564
type: task
role: plan
title: "[Skill:test] sweep the ambient-precondition class: dashboard-assets-loader test fails on every built checkout"
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
Approach: `packages/lore/tests/unit/dashboard-assets-loader.bun.test.ts` (~line 209) asserts `expect(existsSync(GENERATED_MANIFEST_PATH)).toBe(false)` as a "precondition sanity" check before spawning `bun run typecheck`. That precondition is AMBIENT: `packages/lore/src/generated/dashboard-assets.ts` is produced by `bun run build`, which is REQUIRED before running any `.bun.test.ts` suite that spawns `dist/lore`. So on every built checkout — i.e. every checkout where the full suite can legitimately run — this test fails. Observed live: full two-runner suite at commit de77584 on a clean isolated worktree → vitest 387/387 green, bun 1492 pass / 1 fail, the single failure being exactly this assertion.
This is a RECURRENCE of the class the F5a session already fixed once in `dashboard-command.bun.test.ts` (there via an explicit force-unavailable seam). The instance was fixed; the class was not swept. The test's own comment ("otherwise this scenario would prove nothing") shows the author saw the hazard and still coupled to ambient state.
Fix at root cause — the test must CONTROL its precondition, or assert something ambient-independent:
- Preferred: assert the real invariant at the SOURCE level — that `dashboard-assets-loader.ts` contains no STATIC import of the generated module (deterministic, ambient-free), and keep the spawned `bun run typecheck` check only if it can be made independent of whether the manifest exists (it should pass either way — that IS the invariant).
- Acceptable alternative: temporarily relocate the generated file and restore it in a `finally`, so the scenario holds in both environments.
⛔ Do NOT delete the generated artifact without restoring it, and do NOT weaken the test to a tautology.
Source: attested full-suite run at de77584 (clean isolated worktree); the same-class fix already landed in `task-skill-test-f5a-source-run-guard-test-must-control-its-own`.
Dimensions: D-FUNC, D-REGRESSION
Scope-Alt: none — a test that fails on every built checkout blocks the full-suite exit criterion.
Covers: (no spec AC — regression hygiene supporting this plan's Invariant 5 / Exit Criteria)

AC:
- With the generated manifest PRESENT: `cd packages/lore && bun test tests/unit/dashboard-assets-loader.bun.test.ts` → exit 0.
- With it ABSENT (move aside, restore afterwards): same command → exit 0. Run BOTH ways and record BOTH exit codes — a test that passes in only one environment is not fixed. This mirrors the acceptance rule that caught the sibling defect.
- `bun run typecheck` exit 0; the checkout is left with the generated file in whatever state it started (assert no net change).
