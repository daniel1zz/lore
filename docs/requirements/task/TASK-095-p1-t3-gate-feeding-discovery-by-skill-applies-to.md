---
id: TASK-095
type: task
role: plan
title: "P1-T3: gate feeding discovery by skill.applies_to"
status: archived
priority: high
phase: Phase 2 - migrate + discovery
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-023
plan: PLAN-023
links:
  - {id: TASK-096, type: blocks}
---
Approach: add findFeedingSkill(store, appliesTo) → newest approved knowledge/skill whose extra.skill.applies_to matches; gate.ts/gate-feeding.ts use it INSTEAD of the hardcoded WRITE_SPEC_RULE_TITLE constant. Backward-compat: none found → placeholder + missing reasons (slice-1 behavior). TDD.
AC (=AC-P1-3): gate resolves rule doc via applies_to="spec"; slice-1 spec-loop-e2e.bun.test.ts STILL GREEN (backward-compat, R2).
Estimate: M
Depends: P1-T1, P1-T2
Files: packages/lore/src/adapters/cli/commands/gate.ts, packages/lore/src/service/gate-feeding.ts, + bun test
