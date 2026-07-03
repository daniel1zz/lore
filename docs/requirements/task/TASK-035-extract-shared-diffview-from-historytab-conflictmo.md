---
id: TASK-035
type: task
role: plan
title: "Extract shared DiffView from HistoryTab + ConflictModal (AC-DH-4)"
status: archived
priority: medium
phase: hardening
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, refactor]
parent: PLAN-006
plan: PLAN-006
links:
  - {id: TASK-030, type: blocks}
  - {id: TASK-031, type: blocks}
---
Create packages/dashboard/src/components/DiffView.tsx; replace duplicated unified-diff line-coloring in HistoryTab.tsx:75-87 and ConflictModal.tsx:139-151. Keep ConflictModal's controlled disclosure behavior (no native <details> — known re-render trap documented in component). Oracles: typecheck + vitest.
