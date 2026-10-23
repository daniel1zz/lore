---
id: TASK-1611
type: task
role: plan
title: "D4 review inputs measured once per batch (full suite on main; stale-only snapshot failures) and close with linked issues"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Spec Part D (corrected v46) and BR-1372 (amended).

Measured: `lore assess --where status=approved,open-tasks=0` reviewed 19 finished plans, and 18 failed. Failed dimensions: snapshot_accuracy 16, regression 14, spec_conformance 13, correctness 11.
- The regression reasons are almost all "no full-suite run recorded". By design the full suite moved to the plan-close chain, but nothing feeds that run to the review.
- The snapshot reasons count "unknown" (no code anchors, dirty tree, no commit recorded) as failures.

Fix:
1. `lore assess` runs `bun run check:plan-close` and the full test suite once per batch on main's HEAD, in a throwaway worktree of main and never in the shared checkout. It stores the result (exit code, failing files, commit) and gives it to every plan's regression dimension. A failing file is attributed to a plan only if the plan's landed diff touched it or its direct imports.
2. snapshot_accuracy: only "stale" cited rules fail. "unknown" becomes n/a, with the reason.
3. Plan close (checkPlanClose): a failing review still allows the close when every failed dimension has at least one OPEN GitHub issue linked to the plan, through the existing issue carrier link (extra.issues / --resolves). The close audit records "accepted with known defects: #n...".
4. `lore assess --file-issues` files one issue per failed dimension (title: plan + dimension, body: the finding) through the existing report-issue path and links it. One batched call.

Tests: each of 1 to 4, with a fake judge and a fake issue port. A failing review without linked issues still refuses the close (exit 4, BR-1372).
