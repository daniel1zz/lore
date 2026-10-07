---
id: TASK-906
type: task
role: plan
title: "[Skill:implement] setup language projection via ClaudeSettingsPort"
status: archived
priority: high
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-910, type: blocks}
  - {id: TASK-904, type: blocks}
---
Estimate: M
Approach: per spec D3. NEW interface `ClaudeSettingsPort` (does not exist yet) in NEW file packages/lore/src/adapters/claude-settings-port.ts: `mergeLanguage(path, value): Result<void, LoreError>` merge-writes ONLY the `language` key (all other keys/bytes preserved; absent file → created). Wire it in setup: global context.language → `<home>/.claude/settings.json`; project context.language → `<project>/.claude/settings.local.json`; codes via LANGUAGE_NAMES; unknown code → VALIDATION_ERROR naming it. The project-scope steps live in packages/lore/src/flows/setup-project-flow.ts — also invoke the project `lore context refresh` flow there so Z1 fragments land on setup. setup-service.ts currently has no language handling — add it there for the user scope.
Source: spec D3; packages/lore/src/service/setup-service.ts (settings merge), packages/lore/src/flows/setup-project-flow.ts
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-5, AC-CF-18

AC:
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-5'` and `-t 'AC-CF-18'` → ≥1 pass, 0 fail each (AC-CF-18's check half comes from the cli task, which blocks this one).

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
