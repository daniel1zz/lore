---
id: TASK-1475
type: task
role: plan
title: "[Skill:test] R0-1 tests assert the fragment rules, not the rewritten prose (#227)"
status: archived
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1469, type: blocks}
  - {id: TASK-1477, type: blocks}
---
Estimate: M
Resolves: task-gh-1343388703-227
Approach: the rules fragments were compressed (8df98b2e, dde305e7); five tests still pin the old literal sentences. Replace each pinned literal with an assertion of the same rule against the current fragment text (e.g. the rule's key tokens), never by deleting the check. Tests: packages/lore/tests/unit/setup-governance-retirement.test.ts (2 handoff-neutrality cases), packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts (AC-CF-8), packages/lore/tests/e2e/governance-compiled.bun.test.ts:111 (AC-083-1), packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts:451 (AC-CP-7). If a test pins a manifest checksum, re-check after bun run build.
Covers: AC-R0-1, AC-R0-2
AC:
- each of the five cases passes on main and goes red when the rule's key token is removed from the fragment (state the mutation in evidence)
