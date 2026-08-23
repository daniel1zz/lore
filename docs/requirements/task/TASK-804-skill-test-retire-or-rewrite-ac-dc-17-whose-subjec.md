---
id: TASK-804
type: task
role: plan
title: "[Skill:test] retire or rewrite AC-DC-17, whose subject (cap quota) no longer exists"
status: archived
priority: high
phase: "P1: Cap removal"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-775, type: blocks}
---
Estimate: S
Approach: the AC-DC-17 describe block in `packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts` asserts `tryFileReport(...).exitCode === 4` — a cap refusal. The cap was deleted by `task-skill-implement-delete-the-six-cap-symbols-and-retire-the`, so the property it measures no longer exists. Retire the block with a recorded reason, or rewrite it to assert what survives.
Source: measured 2026-08-23 by the intake-port implementer, which reported it as a pre-existing failure unrelated to its own diff
Dimensions: D-FUNC
Scope-Alt: none — a red suite blocks P6's full-suite obligation
Covers: AC-GI-9

## Why this exists separately

`AC-DC-17` belongs to `spec-the-defect-channel-cannot-be-honestly-maintained-an`, which the current spec SUPERSEDES. Its subject was §M7's property that an `adopted` resolution FREES CAP QUOTA — cap quota no longer exists, so the assertion is not merely failing, it is unfalsifiable: there is no implementation that could make it pass.

⛔ Do NOT "fix" it by making the assertion looser. Either the block is retired because its subject is gone, or it is rewritten to assert a property that still exists (e.g. that `adopted` still reads as non-terminal and still requires a live owner pointer — that half survives the cap's removal). Choose one and say which, in the commit message and in the evidence.

The cap-removal task repaired nine other test files for exactly this reason and recorded each as same-invariant/different-witness; this one was missed because it lives under `tests/e2e/`, outside the paths that task's own scan covered.

## AC

- Given `bun test packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts`, When it runs, Then exit 0
- Given the retired-or-rewritten block, When its diff is read, Then it states WHICH of the two dispositions was chosen and why — a silent deletion of a failing assertion is indistinguishable from hiding a defect
- Given a repo-wide case-sensitive scan for the six deleted cap symbols, When it runs after this change, Then it is still 0 (AC-GI-9 stays green)
- SCOPED typecheck exit 0
