---
id: TASK-2092
type: task
role: plan
title: "Baseline recording, colour bands and gate eligibility"
status: draft
priority: medium
phase: "Surface"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-262
plan: PLAN-262
links:
  - {id: TASK-2091, type: blocks}
  - {id: TASK-2124, type: blocks}
  - {id: TASK-2102, type: blocks}
  - {id: TASK-2066, type: blocks}
---
## Objective
Store baselines as append-only corpus rows (metric, epoch, value, window, sample_size, recorded_by, ts, reason) written with their audit entry in one store transaction, unique per (metric, epoch); `lore metrics baseline [--apply]` adds epoch 1 for ok metrics without one; `--rebaseline <metric> --reason` appends the next epoch; no update or delete path; colour bands 10% / 25% with the 95% interval, exact-edge rule and the zero-baseline exception, output as `trend_vs_baseline` and printed 'vs baseline: <colour>' (D17, BR-1406); baselines store their 95% interval and the trend interval combines both by MOVER ratio, switching to the difference interval when the baseline interval reaches 0; no colour below 20 facts (S3 round 2, eng 8 and 10, BR-1405, BR-1460); `lore metrics eligibility <metric>` (audited question-A metrics only, kappa lower bound). Concurrency tested through the LORE_TEST_BASELINE_BARRIER seam.

Spec: spec-evaluation-thresholds-and-trend-surface (BR-1405, BR-1416, BR-1418, BR-1406, BR-1407; BR-1005 stays true).

Covers: AC-TS-1, AC-TS-2, AC-TS-3, AC-TS-8

## Must resolve before evidence

From the final review of the approved bundle (rev6). Resolve each item before recording evidence for this task.

1. spec-evaluation-thresholds-and-trend-surface, E-D16: the barrier seam text still says it pauses 'after reading the settings' and justifies itself by the compare-and-swap that E-D1/E-D8/E-D15 removed. Restate it for the store design (pause after reading the current epochs, before the insert transaction).
2. spec-evaluation-thresholds-and-trend-surface, AC-TS-1 command echo: the PASS message still says 'hand edits show as unaudited', a mechanism the spec dropped (BR-1418, E-D15). Reword it to the append-only / audit-chain behaviour (command text only; the statement is unchanged).
3. spec-evaluation-thresholds-and-trend-surface, BR-1405 / AC-TS-1 / E-D8: transaction scope of a multi-metric --apply is unstated. Recommended: one --apply writes all its rows and audit entries in a single transaction (all-or-nothing; the race loser exits 4 having written nothing), matching BR-1405's example and E-D8's 'nothing half-written'.

Each decision must be recorded in the spec (rule text via `lore rule propose ... amend`, Design Decisions row, and the criterion if its assertion changes) when this task lands, through the normal review and approval of that spec revision.
