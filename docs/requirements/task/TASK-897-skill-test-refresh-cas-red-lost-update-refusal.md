---
id: TASK-897
type: task
role: plan
title: "[Skill:test] refresh CAS RED — lost-update refusal"
status: archived
priority: high
phase: "Phase 2: Pure services"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
---
Estimate: S
Source: AC-CF-13; impl task: refresh
TDD-Role: red
Scenarios (describe 'AC-CF-13'):
- Given a fake FsWritePort whose file content changes between the refresh's read and write, When runContextRefresh, Then result err CONFLICT and the file equals the interleaved writer's bytes.
- Given no interleaving, Then ok and the fragments section is present.
AC:
- Run → RED for missing CAS/fragments support; record expected-fail evidence at that moment.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
