---
id: TASK-914
type: task
role: plan
title: "[Skill:implement] D16 rules writes independent of CLAUDE.md splice refusal"
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
Estimate: S
Approach: per spec D16 (approved v55) — in runContextRefresh, compute the CLAUDE.md splice admission and the rules-file write set independently: if CLAUDE.md admission refuses (AC-CTX-8 ceiling), skip the CLAUDE.md write but still perform the D15 rules writes/prunes (keeping per-file CAS: a CAS conflict on any rules file suppresses all rules writes), then return an error that names the CLAUDE.md refusal and reports what rules files were written. CLI exit stays non-zero. Add e2e describe 'AC-CF-22' in tests/e2e/context-fragments-compiled.bun.test.ts (red first) and a unit test in tests/unit/context-fragments/refresh-idempotence.test.ts or a new file.
Source: spec D16, D15, D8; AC-CTX-8 (spec-context-verb-family-two-zone-claude-md-anatomy-lore) must stay green
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-CF-22

AC:
- `bun run build && cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-22'` ≥1 pass 0 fail (red first recorded); full context-fragments-compiled + context-verbs-compiled 0 fail; vitest context-fragments + flows/context-flow*.test.ts pass; typecheck 0.
