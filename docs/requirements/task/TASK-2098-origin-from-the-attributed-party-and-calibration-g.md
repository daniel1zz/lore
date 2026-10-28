---
id: TASK-2098
type: task
role: plan
title: "Origin from the attributed party and calibration groups split by origin"
status: draft
priority: medium
phase: "Honesty"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2060, type: blocks}
  - {id: TASK-2118, type: blocks}
  - {id: TASK-2122, type: blocks}
  - {id: TASK-2092, type: blocks}
---
## Objective
Give every comparison, outcome and audit fact an origin derived from the write's attributed party (BR-1055): store it on new rows at write; a one-time upgrade step stores the origin of every existing row (resolved party, else unknown; A-D4, no read-time classification); split question A's counts and `lore calibration --stats` groups by origin. Follow the O1-S1 branch recorded by the honesty experiment (path B: 80.1% of comparison rows, 981 of 1225, are unknown; print the share in this task's evidence).

Test-run repair (BR-1455, A-D17, O1-S2 path B, revised S3 round 2): in the same upgrade step (`packages/lore/src/store/migrations/test-run-repair.ts`, outside the metrics package), END each run that meets all three facts (session id test-session-<ms>-<random>, never ended, nothing attributed in versions or audit) with end reason test-run-repair and origin unknown; one audit entry per repaired run; rows kept; four origins only. Re-read the schema version inside BEGIN IMMEDIATE (sqlite-store.ts reads user_version outside the lock today, about line 383) and select only unended runs, so concurrent or repeated upgrades repair each run once; the test forces the overlap through LORE_TEST_MIGRATION_BARRIER. Expected on this repository: 81 runs ended. Runs after the #411 task lands (blocks link), so no leak can follow the repair.

Spec: spec-evaluation-metric-envelope-and-honest-origins (BR-1383, BR-555 modified, BR-1455). Resolves #406.

Covers: AC-EM-2, AC-EM-7
