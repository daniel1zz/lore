---
id: TASK-1338
type: task
role: plan
title: "[Skill:test] Fragment outlet expansion and project determinism — RED scenarios"
status: archived
priority: high
phase: "Phase 1: Core expander and fragment outlets"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
---
Estimate: M
Source: spec AC-CV-2, AC-CV-3, D4, D5, D10
TDD-Role: red | Paired-Impl: T2
Covers: AC-CV-2, AC-CV-3

Scenarios:
- Fragment with {{lore:capture_tail_chars}} → rules file, skill file and subagent-start block each contain String(CAPTURE_TAIL_CHARS), no "{{lore:"; rules-file fingerprint == hash(expanded body).
- Fragment without "{{lore:" → bytes identical to the current renderer output (golden captured in the test from the pre-change render function or a fixture committed with the test).
- Spawn `bun packages/lore/src/index.ts context refresh` in a mkdtemp repo (lore init first) with a project fragment naming {{lore:nope}} → exit 4, stderr names .lore/context/<file>:<line> and nope; no .claude/rules/lore-*.md written.
- Duplicate-line detection sees the expanded text (two fragments whose lines are equal only after expansion are reported).
- Invocation var in a fragment refused at rules:project, skills:project, rules:user, hook:subagent-start naming var + outlet.
- Same repo rendered with two different HOME dirs (different user fragments / global config) → byte-identical project rules files.

Golden: before any implementation, capture the current rules-file renders of all shipped static fragments into packages/lore/tests/fixtures/context-variables/pre-change-rules/ and commit them with the tests.

AC:
- packages/lore/tests/unit/context-fragments/fragment-variables.test.ts and fragment-variables-scope.test.ts written; RED for missing implementation; expected-fail evidence recorded at red time.
