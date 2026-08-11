---
id: TASK-548
type: task
role: plan
title: "[T2] RED: hint both-directions assertion (AC-OOB-6)"
status: archived
priority: medium
phase: "RED"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
links:
  - {id: TASK-544, type: blocks}
---
Extend the EXISTING packages/lore/tests/unit/adapters/report-issue-hint.bun.test.ts with an AC-OOB-6 case asserting BOTH directions: an unconfigured consumer's gate-denial stderr carries exactly 1 provision-guidance line (today 0 — this is the RED half), AND a configured consumer's stderr stays byte-identical to the SPEC-073 AC-073-1 baseline wording. Extend-only: do not weaken or rewrite the existing AC-073-1/2/3 cases — they are the regression floor for invariant 3.
