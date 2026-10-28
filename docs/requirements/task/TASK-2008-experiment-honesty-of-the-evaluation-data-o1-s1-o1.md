---
id: TASK-2008
type: task
role: plan
title: "Experiment: honesty of the evaluation data (O1-S1, O1-S2, O1-S3)"
status: archived
priority: medium
phase: "Experiments"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2099, type: blocks}
  - {id: TASK-2098, type: blocks}
  - {id: TASK-2100, type: blocks}
  - {id: TASK-2076, type: blocks}
---
## Objective
Run OST experiments O1-S1, O1-S2 and O1-S3 read-only on this repo's corpus and record the results and the branch that fired (plan Decisions Log rows O1-S1, O1-S2, O1-S3).

## Steps
- O1-S1: classify the origin of every comparison record from its resolved run (human session / harness run / none); report the undecidable share against the 5% trigger.
- O1-S2: try to answer all eleven questions A–K from the current DB with the envelope fields of S-A (sample size, window, newest fact, origin, status); report whether the procedure flags #409 (telemetry off) and #411 (test runs).
- O1-S3: locate the write site that puts cc:test-session-* runs into the repo corpus (candidate: packages/lore/tests/unit/feed-resume-same-session.test.ts builds that id form); confirm by reading, never by running tests against the repo corpus.

## Output
One research knowledge doc linked `informs` to this plan: each measured value, its query, and the fired path.

Covers: none (experiment; criteria are owned by the implementation tasks).

## Closing route
Close it with `lore evidence <task> --oracle other --command "lore get <research doc slug>" --result pass --capture` plus the no-new-tests declaration, then `lore done` (attestation floor route 2, task-workflow-service.ts ATTESTATION_FLOOR_REPAIRS).
