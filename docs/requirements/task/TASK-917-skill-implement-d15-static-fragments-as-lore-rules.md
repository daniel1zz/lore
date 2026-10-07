---
id: TASK-917
type: task
role: plan
title: "[Skill:implement] D15 static fragments as lore rules files"
status: archived
priority: critical
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-910, type: blocks}
---
Estimate: L
Approach: per spec D15 — rename OutletId 'claude-md:project'|'claude-md:user' → 'rules:project'|'rules:user' (core + select + fragments-flow + CLI flags/strings); section.ts renders one file per static fragment: first line `<!-- lore:managed fragment=<id> hash=<8hex> -->` (hash over body) then body; runContextRefresh(scope) writes `<root>/.claude/rules/lore-<id>.md` (project) or `<home>/.claude/rules/lore-<id>.md` (user) with per-file CAS, reports diverged_skip for a file whose body no longer matches its own fingerprint (bytes untouched), prunes `lore-*.md` files not in the current selection, never touches non-`lore-` files, and no longer splices a `fragments` Z1 section into CLAUDE.md (remove that code path from init and refresh). Each rules file is checked against context.memory_files.rules budget (existing role 'rules'). lore fragments check: drift = rules files changed/missing/extra vs fresh render; session-start stale backstop uses the same comparison.
Source: spec D15, D7, D8, D14; packages/lore/src/flows/context-flow.ts; packages/lore/src/service/context-fragments/section.ts; packages/lore/src/flows/fragments-flow.ts
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-4, AC-CF-6, AC-CF-8, AC-CF-12, AC-CF-13, AC-CF-15

AC:
- Every test re-baselined by the paired RED task passes; `bun run build && cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts` 0 fail; resume-coverage-compiled, context-provenance-compiled, context-verbs-compiled 0 fail; vitest packages/lore/tests/unit/context-fragments + flows/context-flow*.test.ts + flows/fragments-flow.test.ts + packages/core/tests/unit/context-fragments.test.ts pass; typecheck 0.
- Falsifier runs: disable prune → AC-CF-6 red; overwrite diverged file → AC-CF-6 red.
