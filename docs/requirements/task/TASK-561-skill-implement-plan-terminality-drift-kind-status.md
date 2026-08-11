---
id: TASK-561
type: task
role: plan
title: "[Skill:implement] plan-terminality drift kind, status rendering, --fix exclusion"
status: archived
priority: critical
phase: "Phase 1: Terminality detector"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
---
Estimate: M
Approach: Add `"plan-terminality"` to `DriftKind` in packages/lore/src/service/tree-check-service.ts (line ~23) and a detector in checkTree(): for each `plan` doc whose status is NOT archived/deprecated, load its child `task` docs; if count >= 1 AND every child is archived/deprecated, emit a drift. Render it in `lore status --check-tree` (packages/lore/src/adapters/cli/commands/status.ts) with the exact remediation command `lore set <plan-slug> --status archived`. ⛔ EXCLUDE it from `--fix` (today --fix repairs orphan/misplaced only) — auto-transitioning a plan would fire the plan-close gate from inside a repair command.
Source: spec DD-1; explorer fact sheet (DriftKind union line ~23, TreeReport shape, status.ts flags lines 253-286)
Dimensions: D-FUNC
Scope-Alt: none — this is the durable detector the whole spec rests on
Covers: AC-CLOSURE-1, AC-CLOSURE-2

AC:
- Given a plan with >=1 child task where ALL are archived/deprecated and the plan is not terminal, When checkTree runs, Then a `plan-terminality` drift is reported naming the plan.
- Given (a) a plan with zero tasks, (b) a plan with >=1 non-terminal task, (c) an already-archived plan, When checkTree runs, Then NO plan-terminality drift is reported for any of them (all three asserted separately — a detector that fires on the vacuous case is worse than none).
- Given `lore status --check-tree` against a corpus containing the drift, Then it exits nonzero and prints the plan slug plus the literal remediation command.
- Given `lore status --check-tree --fix`, Then the plan-terminality drift is STILL reported afterwards and no plan doc's status changed (assert the status before/after).
- `bun run typecheck` exit 0 (a non-exhaustive switch over DriftKind must surface here, not at runtime).
- Evidence MUST record how many plan-terminality drifts this repo's own corpus has at landing time (pre-push runs --check-tree; a sudden failure is the detector working, not a regression, and the count must be known).
