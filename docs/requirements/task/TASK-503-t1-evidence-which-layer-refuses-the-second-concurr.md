---
id: TASK-503
type: task
role: plan
title: "T1 evidence: which layer refuses the second concurrent writer"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-090
plan: PLAN-090
links:
  - {id: TASK-478, type: blocks}
---
## Task

Covers spec D1. NO implementation commit may land before this task completes. Determine with evidence which layer refuses the second concurrent report-issue writer and with what error class (is the observed exitCode 1 a SQLITE_BUSY-class contention error or a higher-level validation failure). Then choose Option 1 or 2 on that evidence and write the literal exit code plus the stderr message template into the spec's Contract Details via lore set.
