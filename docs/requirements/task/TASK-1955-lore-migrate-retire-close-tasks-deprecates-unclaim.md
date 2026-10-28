---
id: TASK-1955
type: task
role: plan
title: "lore migrate retire-close-tasks deprecates unclaimed close tasks, preview first (AC-LND-5)"
status: deprecated
priority: high
phase: "P3 Land, dispatch, log, drift"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1949, type: blocks}
---
Covers: AC-LND-5
TDD-Role: green
Approach: close-task-migration-service.ts finds close tasks (slug prefix task-close-plan-, no file anchor) and, on apply, releases any claim, appends each evidence row to the plan's execution_log as an evidence-moved entry (the execution-log writer of the execution-log task accepts a plan), deprecates the task and removes its blocks edges; a second apply writes nothing. commands/migrate.ts gains the retire-close-tasks action in the same task. This is the only place a close task is recognised; plan close has no close-task case.
Done when: AC-LND-5 passes through the compiled binary; typecheck passes.
