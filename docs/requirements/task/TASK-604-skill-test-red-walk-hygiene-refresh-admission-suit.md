---
id: TASK-604
type: task
role: plan
title: "[Skill:test] RED — walk-hygiene + refresh-admission suites (AC-CTX-9/8)"
status: archived
priority: medium
phase: "Phase 4: Hardening"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-088
plan: PLAN-088
links:
  - {id: TASK-603, type: blocks}
---
## Objective
Write RED (initially failing) test cases pinning AC-CTX-9 (module-index walk hygiene) and AC-CTX-8 (refresh pre-write admission) BEFORE the implementation lands. Extend the two existing suites in place; do not touch src/.

## Spec / AC
- Spec: spec-context-verb-family-two-zone-claude-md-anatomy-lore — AC-CTX-9, AC-CTX-8 (read `lore ac list` for exact statements).
- Incident/root-cause context: knowledge-retro-context-refresh-module-index-walk-pollutes.

## Required RED cases
context-facts.test.ts (AC-CTX-9), using the existing InMemoryFsPort fixture style:
1. dot-dir skip: tree with `.serena/cache/typescript/x.ts` → no `.serena*` entry in moduleIndex.
2. root .gitignore: `.gitignore` containing `dist-npm/` + populated `dist-npm/**` tree → no `dist-npm*` entries; sibling non-ignored dir still indexed.
3. nested .gitignore: `packages/a/.gitignore` ignoring `generated/` → `packages/a/generated` skipped, `packages/b/generated` still indexed.
4. negation: `.gitignore` with `build/` + `!build/keep/` → `build` skipped except `build/keep` indexed (document actual chosen semantics if a mature .gitignore lib resolves this differently — assert the lib-consistent behavior).
5. fallback: no .gitignore anywhere → static denylist behavior unchanged (existing cases stay green).

context-flow.test.ts (AC-CTX-8):
6. breach refusal: a facts fixture whose spliced CLAUDE.md would exceed the ceiling → refresh returns non-ok naming ceiling findings AND the fs write port records NO write for CLAUDE.md.
7. within-budget: normal fixture → write happens, report unchanged vs current behavior.
8. boundary: spliced size exactly at the ceiling → allowed (ceiling is max, breach is strictly-greater) — match the semantics of the existing claude-md-check implementation; read it first.

## Oracle
`bunx vitest run packages/lore/tests/unit/service/context-facts.test.ts packages/lore/tests/unit/flows/context-flow.test.ts` — new cases MUST FAIL against current src (record the red run as evidence with --result fail is NOT needed; evidence records the suites exist and are red: use oracle test, result pass is reserved for the green wave — record RED via `lore evidence --oracle test --result pass` ONLY for "suites compile and the NEW cases fail for the intended reason"; paste the failing-assertion tail).
