---
id: TASK-274
type: task
role: plan
title: "[Skill:test] Seat suites — RED"
status: archived
priority: critical
phase: "Phase 1: Seat slice"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-069
plan: PLAN-069
links:
  - {id: TASK-270, type: blocks}
---
Estimate: S
Source: SPEC-057 AC-S-1..5, AC-S-7
TDD-Role: red | Paired-Impl: U2+U3
Covers: AC-S-1, AC-S-2, AC-S-3, AC-S-4, AC-S-5, AC-S-7
Scenarios:
- Given the 4-class GitFacts table, When classifySessionLocation, Then each class maps to its documented location
- Given rebase ok then worktreeAdd throws, When enter, Then err names the step AND second enter succeeds
- Given seat signal on bootstrap, When deriveResumeHint, Then plan-scoped; absent -> frozen-baseline byte-identical
- Given a seat-worktree session, When the SessionStart hook runs against the stubbed lore script, Then the logged invocation contains --seat-branch with the branch value; main-checkout log byte-unchanged (AC-S-4)
- Given golden sanitize pairs, When run in BOTH hook and core suites, Then all pass
AC:
- All named suites (incl. packages/lore/tests/unit/hooks/session-seat-injection.test.ts additions) exist and are RED for missing-implementation reasons only
