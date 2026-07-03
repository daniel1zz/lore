---
id: TASK-031
type: task
role: plan
title: "Component tests: Editor / NewDocModal / StatusPill / LinksPanel / ConflictModal (AC-DH-8)"
status: archived
priority: high
phase: surface
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, test]
parent: PLAN-006
plan: PLAN-006
links:
  - {id: TASK-029, type: blocks}
---
New vitest jsdom test files under packages/dashboard/tests/component/ for the five components (HistoryTab owned by the delete/restore task). Each: happy render + key interaction + one error/edge path. Cover Editor initialValue remount + onChange timing; ConflictModal Escape close, force-overwrite pending disabled, controlled diff disclosure; StatusPill transition menu; LinksPanel add/remove; NewDocModal validation. Test files only — no src changes. Oracle: vitest.
