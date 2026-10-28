---
id: TASK-2060
type: task
role: plan
title: "Outcome labels, Brier, reliability bins and guard figures"
status: draft
priority: medium
phase: "AI decisions"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-271
plan: PLAN-271
links:
  - {id: TASK-2118, type: blocks}
  - {id: TASK-2122, type: blocks}
  - {id: TASK-2059, type: blocks}
  - {id: TASK-2058, type: blocks}
---
## Objective
Label review judgments from after-events (30-day inclusive horizon, per-verdict table: approves always, rejects only after an observed action, escalations unscored), read autonomy outcomes as the sweep stored them, report Brier and five reliability bins per judge with coverage, and attach the guard figures (issues per landed task, links per document) to every metric built on agent-written facts. Uses the local main-red records of plan 3 when present and an injectable issue port. Follow branch O2-S1 of plan 1.

Spec: spec-ai-decision-correctness-outcome-attribution-and-audit (BR-1387, BR-1411, BR-1388, BR-1409, BR-1389).

Covers: AC-AD-1, AC-AD-2, AC-AD-8, AC-AD-9

## Must resolve before evidence

1. spec-ai-decision-correctness-outcome-attribution-and-audit, BR-1387 / AC-AD-1 (set-back confound, plan 1 experiment O2-S3 and spec-retired-judge-instruction-versions-stay-in-calibration): "set back from approved" also counts the demotion that any edit of an approved spec causes (BR-722); 587 of 637 linked after-events in this corpus were such edit-demotions, which are not reversals. Decide and state which set-backs count as a reversal (for example only `lore reopen`, a `reject` of the approved version, or an invalidation, never an edit-demotion), add the edit-demotion case to AC-AD-1's fixture as not reversed, and record it in the spec (rule text via `lore rule propose ... amend`, Design Decisions row, criterion) through the normal review and approval of that revision. This changes the approved criterion AC-AD-1, so the spec revision is required before evidence. The judge promotion gate's first real promotion (switch task's precondition step in plan-retired-judge-versions-labelled-in-calibration) waits for this task (task-level blocks link).
