---
id: TASK-1625
type: task
role: plan
title: "B5 reads are counted per day, not logged per row"
status: archived
priority: medium
phase: "B"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
links:
  - {id: TASK-1616, type: blocks}
  - {id: TASK-1619, type: blocks}
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. Atomic single-upsert counter (date, count) in all three stores plus a migration (next free number) that drops existing per-read rows. trace stats reads the counter.
