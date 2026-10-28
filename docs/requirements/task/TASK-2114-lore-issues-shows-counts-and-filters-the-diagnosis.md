---
id: TASK-2114
type: task
role: plan
title: "lore issues shows, counts and filters the diagnosis"
status: draft
priority: high
phase: "P2 Filing and listing"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-254
plan: PLAN-254
links:
  - {id: TASK-2082, type: blocks}
---
Covers: AC-MI-3
Approach: readDiagnosis from core per listed issue (labels already read with every page, BR-514, so no extra request, BR-1241); column, summary counts per value, --diagnosis filter with the filtered total (BR-509 shape); an unknown value is a usage error (exit 2).
