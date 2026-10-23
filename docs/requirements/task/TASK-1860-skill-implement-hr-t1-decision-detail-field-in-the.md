---
id: TASK-1860
type: task
role: plan
title: "[Skill:implement] HR-T1 decision detail field in the hash-chained log; governance-loosen records before/after"
status: archived
priority: medium
phase: "record-and-read"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
links:
  - {id: TASK-1866, type: blocks}
  - {id: TASK-1865, type: blocks}
  - {id: TASK-1861, type: blocks}
---
Estimate: M
Approach: Add a `detail` column to decision_log (new migration) holding JSON {summary, requested_by, change, on_accept, on_reject}. Include it in computeDecisionEntryHash only for rows that carry it (versioned payload) so every existing row and every pushed chain head still verifies. DecisionService record path takes the detail; decide()'s strict facts schema stays unchanged (detail is not a factor). Fill it for governance-loosen in autonomy-threshold-service.ts: change = {entry, before, after} of the governed record; requested_by = acting run/actor. Provide one renderer helper returning the honest label 'no detail recorded (decided before detail existed)' for detail-less rows, used by CLI and HTTP.
Source: spec-human-review-surface-decisions-audit-items-and-pending D1.
AC: AC-HR-2 (whole) and the governance-loosen case of AC-HR-1 (put it in the AC-HR-1 test file; T2 adds the other classes). Make each oracle go red once (drop detail from the hash; drop before/after).
