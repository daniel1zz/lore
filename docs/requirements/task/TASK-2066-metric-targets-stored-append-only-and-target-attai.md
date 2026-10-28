---
id: TASK-2066
type: task
role: plan
title: "Metric targets stored append-only and target attainment beside the trend vs baseline"
status: draft
priority: medium
phase: "Surface"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-262
plan: PLAN-262
links:
  - {id: TASK-2091, type: blocks}
  - {id: TASK-2102, type: blocks}
  - {id: TASK-2101, type: blocks}
---
## Objective
Store declared targets as append-only corpus rows (metric, epoch, value, good direction, source, recorded_by, time, reason) with their audit entry in one transaction, unique per (metric, epoch): `lore metrics target [--apply]`, `lore metrics target --retarget <metric> --value <v> --reason <text>`, no update or delete, barrier seam like baselines. A row is accepted only when its source cites external evidence or names an owner decision recorded from a person's terminal; a proposed target without one is refused (exit 4) and its metric shows no_target (S3 round 2, design 9). Each metric definition declares its target (value, direction, source) from the spec's Target table; metrics listed as no target declare none. Compute `target_attainment` (met, not_met, within_noise, no_target; a bound equal to the target is met; a metric that is itself a 95% bound, the kappa lower bound, is compared directly; fewer than 20 facts: no judgment, BR-1460) separately from `trend_vs_baseline`, and print both with the raw value in text and JSON; no_target and within_noise never styled as good.

## Owner decisions this task reads

- D22, 2026-10-26: all S-E targets accepted as listed (plan-evaluation-5-thresholds-and-trend-surface, Decisions Log). Rows sourced "proposed — owner decides at S4" are stored with source `owner decision D22 (plan-evaluation-5 Decisions Log, 2026-10-26)` plus the id of the human-tty decision record. First step: put one confirmation of D22 to the user through the ask channel (`lore pending --ask`, recorded as human-tty) and cite that record's id; until it exists those rows are refused (exit 4) and read no_target. Rows citing external evidence or the live rule BR-1410 need no owner decision.

Spec: spec-evaluation-thresholds-and-trend-surface (BR-1452, BR-1453, BR-1454, BR-1460).

Covers: AC-TS-9, AC-TS-10

Red first: record the AC-TS-9 and AC-TS-10 red runs (expected-fail) before the change; keep the falsifier literals `INSERT INTO metric_targets` (target-store.ts) and `"not_met"` (attainment.ts).
