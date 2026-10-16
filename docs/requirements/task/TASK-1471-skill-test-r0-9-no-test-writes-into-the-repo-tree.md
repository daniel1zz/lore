---
id: TASK-1471
type: task
role: plan
title: "[Skill:test] R0-9 no test writes into the repo tree (.vocab-probe race)"
status: archived
priority: medium
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: S
Resolves: (new finding, no report)
Approach: some test writes packages/dashboard/.vocab-probe into the repo tree while phase-write-lifecycle-doc-parity.test.ts greps packages/ (exit 2: No such file or directory). Find the writer (grep -rn vocab-probe packages scripts), move its probe file into a mkdtemp dir, and make the grep helper tolerate files vanishing mid-scan (grep -s) only if the writer cannot be fixed.
Covers: AC-R0-1
AC:
- no test writes under packages/ (grep shows the probe path is under a tmp dir); phase-write-lifecycle-doc-parity.test.ts passes 3 consecutive runs while the writer's test runs in parallel
