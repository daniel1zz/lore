---
id: TASK-1862
type: task
role: plan
title: "[Skill:implement] HR-T6 dashboard Needs-you page: decisions, audit items, pending reviews, read-only detail pages"
status: archived
priority: medium
phase: "surfaces"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
---
Estimate: M
Approach: Dashboard route /needs-you (+ p.$name mirror, thin wrapper over one props-driven component) with three sections: open decisions and audit items from the T3 routes via src/lib/api.ts, documents awaiting review reusing the existing review queue query. Detail routes /needs-you/decisions/$id (and audit). Show summary, before/after, on_accept, on_reject, factors by name, recommendation, and the terminal command 'lore decide <id> --accept|--reject' with a one-line explanation that answering happens in the terminal. Read-only: no mutation import. Add a nav entry.
Source: spec-human-review-surface-decisions-audit-items-and-pending D3.
AC: AC-HR-4.
