---
id: TASK-899
type: task
role: plan
title: "[Skill:test] compiled e2e RED — fragments CLI, hooks, setup, governance retirement, agents"
status: archived
priority: critical
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
---
Estimate: L
Source: AC-CF-4..12, 15, 17, 18 statements
TDD-Role: red
Scenarios: one describe per AC, named exactly 'AC-CF-N …' so the spec's `bun test -t 'AC-CF-N'` commands select them. Use the compiled `dist/lore` (build first, like existing tests/e2e/*compiled*.bun.test.ts), mkdtemp HOME + XDG_CONFIG_HOME, `lore init` throwaway corpus as cwd, spawn the shipped hook scripts from assets/hooks with JSON stdin payloads. Each describe asserts exactly what its AC statement says (nonces, sentinels, byte-equality, exit codes). AC-CF-7 sentinel: capture a distinctive line of the CURRENT hard-coded executor text in subagent-context.mjs and assert it is absent. AC-CF-8 sentinel: a distinctive sentence from assets/governance/corpus-workflow.md.
AC:
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts` runs every describe and fails for missing implementation (not harness errors); record expected-fail evidence at that moment.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
