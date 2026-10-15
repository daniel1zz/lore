---
id: TASK-1151
type: task
role: plan
title: "R3 implement census fix for #94"
status: archived
priority: medium
phase: "P4-Remediate"
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PLAN-176
plan: PLAN-176
links:
  - {id: TASK-1144, type: blocks}
---
Implementer in a worktree makes R2 green: resolve standalone-const subcommand entries and subcommand-only commands; unresolved cross-package imports surface as not_measured (coverage then exits non-zero), never a silent drop. Scoped oracle: bun run test:changed + typecheck. Estimate: M
