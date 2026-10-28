---
id: TASK-2059
type: task
role: plan
title: "Judge promotion gate and version-labelled calibration groups"
status: draft
priority: medium
phase: "Calibration labels"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-260
plan: PLAN-260
links:
  - {id: TASK-2058, type: blocks}
---
## Objective
Add the promotion gate and keep version history labelled: `lore calibration promote <version> [--kind review]` replays the candidate over the holdout's labelled document versions only (BR-1469: SHA-256 of the version id mod 100 below 30; the tuning split never decides; S-B labels, AI-judge rows only), numbers every attempt per version and prints attempts since the last promotion, stores each attempt per document type (AUC, DeLong 95% lower bound, measured or insufficient below 10 per class) with an audit entry, and appends a promotion row only when every measured type reaches 0.65 and at least one is measured (exit 4 otherwise); append-only store rows, no update or delete. Calibration statistics groups carry prompt_status (current = latest passing promotion of the kind; retired = other versions of a kind with a promotion; unpromoted = every version of a kind with none, e.g. staleness) and last_judged_at, split by origin. The judge does not read promotions yet (the switch task does).

Spec: spec-retired-judge-instruction-versions-stay-in-calibration (BR-1461, BR-1469, BR-1426, BR-555).

Covers: AC-RJ-1, AC-RJ-2, AC-RJ-4

Red first: record the AC-RJ-1 and AC-RJ-2 red runs (expected-fail); keep the falsifier literals "retired" (judgment-service.ts) and AUC_LOWER_BOUND_MIN = 0.65 (judge-promotion.ts).
