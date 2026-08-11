---
id: TASK-594
type: task
role: plan
title: "[T6] formatWorkflowBadge non-fail-is-green classification bug (AC-WH-1)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-28
tags: []
parent: PLAN-106
plan: PLAN-106
---
Found by T5's consumer trace: packages/lore/src/adapters/cli/utils.ts::formatWorkflowBadge renders the lore list/tree task-row badge as green (✔N) for ANY last-evidence result that is not 'fail' — expected-fail and inconclusive both count as green, violating AC-WH-1's never-counted-as-green clause. Fix: pass → ✔N, fail → ✘N, everything else (expected-fail/inconclusive) → distinct non-green marker consistent with T5's ⚑R badge scheme. RED-first with a test pinning all four result values.
