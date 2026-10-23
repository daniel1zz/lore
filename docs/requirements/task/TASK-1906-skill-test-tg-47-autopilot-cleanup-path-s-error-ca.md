---
id: TASK-1906
type: task
role: plan
title: "[Skill:test] TG-47 autopilot-cleanup-path's ERROR case reads a tmpdir file directly and asserts nothing about the shipped-file reader"
status: archived
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: lore assess of plan-cleanup-closes-itself (2026-10-18) found the ERROR case in scripts/tests/autopilot-cleanup-path.test.ts reads a nonexistent tmpdir file directly instead of going through the shipped-file reader the other cases exercise, so it asserts nothing about the code under test (a vacuous oracle). Route it through the same reader so a missing shipped file is refused/reported by the code under test, and make it go red once (mutate the reader to swallow the missing file) before restoring.
Source: lore assess plan-cleanup-closes-itself-lore-done-removes-agent-worktrees 2026-10-18
AC: the ERROR case fails when the reader stops reporting a missing file (recorded expected-fail on the mutation), passes on the real reader.
