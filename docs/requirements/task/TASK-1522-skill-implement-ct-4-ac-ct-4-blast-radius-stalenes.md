---
id: TASK-1522
type: task
role: plan
title: "[Skill:implement] CT-4 AC-CT-4 blast-radius staleness via the shared git diff port"
status: archived
priority: high
phase: "Phase 2: implement"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-202
plan: PLAN-202
links:
  - {id: TASK-1528, type: blocks}
  - {id: TASK-1526, type: blocks}
---
Estimate: M
Approach: AC-CT-4: radius resolver (extractTestFileTokens ∪ file_anchors) and blastRadiusChanged reusing SpawnGitPort.changedSince (lift to one shared port; no second copy); dirty-tree evidence → radius unmeasurable, counted (user decision). See knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine §4 row T4 for anchors and the red-first oracle.
Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it; measurements and design: knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine (§2 measurements, §3 corrections, §4 row for this task).
AC: AC-CT-4 passes via lore verify.
