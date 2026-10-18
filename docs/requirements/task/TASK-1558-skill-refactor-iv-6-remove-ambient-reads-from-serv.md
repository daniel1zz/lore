---
id: TASK-1558
type: task
role: plan
title: "[Skill:refactor] IV-6 remove ambient reads from service, flow and core layers; lower the ledger"
status: draft
priority: medium
phase: "P4 migration"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
links:
  - {id: TASK-1576, type: blocks}
---
Per spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D5 migration. Move every banned-token read in service/, flows/ and core/src (except invocation-node.ts) to parameters from the Invocation. Lower the ledger to match; check:ambient-reads exit 0.
