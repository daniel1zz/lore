---
id: TASK-1835
type: task
role: plan
title: "[Skill:fix] DCL-3 every corpus write goes through one write path (version, audit, actor, foreign-corpus, lock, transaction)"
status: archived
priority: medium
phase: "fix"
created: 2026-10-19
updated: 2026-10-25
tags: []
parent: PLAN-233
plan: PLAN-233
links:
  - {id: TASK-1825, type: blocks}
---
Estimate: L
Approach: see spec D3 (end state) and the bound reports (lore get each); fix the root, not each report.
Source: spec-defect-clusters-round-1-done-floors-judge-real-runs-on D3.
AC: AC-DCL-3.
