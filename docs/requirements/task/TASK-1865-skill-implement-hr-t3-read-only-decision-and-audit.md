---
id: TASK-1865
type: task
role: plan
title: "[Skill:implement] HR-T3 read-only decision and audit-item HTTP routes that append nothing"
status: archived
priority: medium
phase: "record-and-read"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
links:
  - {id: TASK-1862, type: blocks}
---
Estimate: M
Approach: GET /api/decisions, /api/decisions/:id, /api/audit-items in the routes.ts dispatcher (cookie + bearer). Add a pure read method on DecisionService (derivePendingDecisions over listDecisionLog, no closeStalePending append, no git/process probes in the HTTP process unless spec'd). Response carries detail (or the honest label), factors by name, recommendation and the answer command text. No path contains 'decide'.
Source: spec-human-review-surface-decisions-audit-items-and-pending D2.
AC: AC-HR-3.
