---
id: TASK-1575
type: task
role: plan
title: "[Skill:refactor] IV-9 runLoreInProcess builds an Invocation; no global mutation; serial queue removed"
status: draft
priority: medium
phase: "P5 test runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
---
Implement spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D6. Precondition: check:ambient-reads --ledger-empty exits 0 on main. Throwaway home required; process.exit interception stays. Latch-based overlap test per AC-IV-8.
