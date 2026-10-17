---
id: TASK-1527
type: task
role: plan
title: "[Skill:implement] CT-6 AC-CT-10 capture-source bucket site scan in the test chain"
status: draft
priority: medium
phase: "Phase 2: implement"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-202
plan: PLAN-202
links:
  - {id: TASK-1526, type: blocks}
---
Estimate: M
Approach: AC-CT-10: scripts/check-capture-source-buckets.ts site scan over both axes, wired into bun run test. See knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine §4 row T6 for anchors and the red-first oracle.
Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it; measurements and design: knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine (§2 measurements, §3 corrections, §4 row for this task).
AC: AC-CT-10 passes via lore verify; the scan is in the test chain.
