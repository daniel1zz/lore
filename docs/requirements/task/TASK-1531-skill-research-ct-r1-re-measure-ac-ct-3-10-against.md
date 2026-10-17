---
id: TASK-1531
type: task
role: plan
title: "[Skill:research] CT-R1 re-measure AC-CT-3..10 against current main"
status: archived
priority: high
phase: "Phase 1: re-measure"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-202
plan: PLAN-202
---
Estimate: M
Approach: For each of AC-CT-3, 4, 5, 6, 8, 9, 10 of spec-corpus-truthfulness-a-verdict-must-carry-the-state-it (read the full statements): measure on current main what the code does (grep, read, run small probes in a mkdtemp corpus), which parts of the criterion already hold, what is missing, and whether the criterion is still correct given changes since 2026-08-23 (stampCurrency in gate-predicates.ts exists; blastRadiusChanged and probeOccupancy do not; the command paths never existed). Record the result as `lore create knowledge --sub-type research`, linked to the spec, with a proposed task breakdown (estimate, anchors, red-first oracle path per task) and any proposed spec correction with its reason.
Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it; user decision 2026-10-17 (separate plan)
AC: the knowledge doc covers all 7 criteria with measured evidence (command + output) for each claim.
