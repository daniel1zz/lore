---
id: TASK-1521
type: task
role: plan
title: "[Skill:implement] CT-2 AC-CT-5 runner reads the stamp before and after the oracle"
status: archived
priority: critical
phase: "Phase 2: implement"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-202
plan: PLAN-202
links:
  - {id: TASK-1517, type: blocks}
  - {id: TASK-1515, type: blocks}
  - {id: TASK-1526, type: blocks}
---
Estimate: L
Approach: AC-CT-5: VerifyRunnerService reads the stamp before and after running the AC command (state_stamp + head_sha); a mismatch demotes the row. The seam is a REAL git commit made by the AC command itself in a throwaway repo. See knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine §4 row T2 for anchors and the red-first oracle.
Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it; measurements and design: knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine (§2 measurements, §3 corrections, §4 row for this task).
AC: AC-CT-5 passes via lore verify; red recorded first.
