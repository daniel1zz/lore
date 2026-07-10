---
id: TASK-097
type: task
role: plan
title: "P1-T2: migrate seed rule doc reference→skill(applies_to=spec)"
status: archived
priority: high
phase: Phase 2 - migrate + discovery
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-023
plan: PLAN-023
links:
  - {id: TASK-095, type: blocks}
  - {id: TASK-096, type: blocks}
---
Approach: update scripts/seed-write-spec-rule.ts to create/upgrade the rule doc as knowledge/skill with extra.skill.applies_to="spec" (idempotent: if a reference-version exists, upgrade sub_type in place; no dup). TDD.
AC (=AC-P1-2): seed → knowledge/skill, applies_to=spec, status approved; re-run idempotent.
Estimate: S
Depends: P1-T1
Files: scripts/seed-write-spec-rule.ts, + bun test (throwaway corpus)
