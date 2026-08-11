---
id: TASK-618
type: task
role: plan
title: "[Skill:test] lint boundary suite — RED (AC-CMC-1 path)"
status: archived
priority: critical
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-616, type: blocks}
---
Estimate: S
Source: AC-CMC-1; paired impl = lint service task
TDD-Role: red | Paired-Impl: lintMemoryFiles task (same phase)

Scenarios (fixtures per role root/module, BOTH metrics):
- Given a root file at max_lines-1 / max_bytes-1, When linted, Then zero findings
- Given a root file at max_lines+1, When linted, Then one finding {kind: max_lines, measured, ceiling} and message names the file
- Given a module file at max_bytes+1 via multibyte CJK content where char length < ceiling but Buffer.byteLength > ceiling, When linted, Then max_bytes finding (UTF-8 correctness)
- Given budgets.enabled=false, When linted, Then zero findings regardless of size
- Given empty file list, When linted, Then zero findings (no throw)

AC:
- Scenarios exist at packages/lore/tests/unit/service/claude-md-check.test.ts (the exact AC-CMC-1 path)
- Run → all RED; failure reason is missing module claude-md-check.ts, not test bugs
