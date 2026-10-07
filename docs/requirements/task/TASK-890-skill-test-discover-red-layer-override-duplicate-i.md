---
id: TASK-890
type: task
role: plan
title: "[Skill:test] discover RED — layer override, duplicate id, system-reminder rejection"
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
Source: AC-CF-1, AC-CF-16 statements; impl task: discover
TDD-Role: red
Scenarios (describe names MUST contain the AC id so `-t 'AC-CF-N'` selects them):
- describe 'AC-CF-1': Given a shipped fragment id=x and a project fragment id=x, When discoverFragments, Then exactly one x with layer 'project'.
- describe 'AC-CF-1': Given two files with id=y in the user layer, Then err whose message contains both paths.
- describe 'AC-CF-16': Given a fragment body containing '<system-reminder', Then err naming the file.
- Inject FsReadPort fake (in-memory map), no disk.

AC:
- Tests written against the spec interface (`discoverFragments(fs, roots)` from packages/lore/src/service/context-fragments/discover.ts).
- Run → RED because the module is missing (not a test bug); record `lore evidence --result expected-fail` at that moment.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
