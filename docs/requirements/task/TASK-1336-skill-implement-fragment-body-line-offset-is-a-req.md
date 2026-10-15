---
id: TASK-1336
type: task
role: plan
title: "[Skill:implement] Fragment body line offset is a required field — remove the re-serialisation estimate"
status: archived
priority: medium
phase: "Phase 1: Core expander and fragment outlets"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
links:
  - {id: TASK-1327, type: blocks}
---
Estimate: S
Approach: make the fragment body's line offset a REQUIRED field of the core `Fragment` type (`bodyLineOffset: number`, frontmatter lines incl. both fences), stamped by discoverFragments; delete the YAML re-serialisation estimate in packages/lore/src/service/context-fragments/expand.ts (`bodyLineOffset()` fallback, lines ~40-42) and the optional `LocatedFragment` widening; every Fragment literal (tests, fragments-flow, setup) supplies the field explicitly.
Source: spec D3 (no silent fallback; path:line counted in the FILE); found after T2 merge (its own concern note)
Covers: AC-CV-2

AC:
- `grep -n "stringifyYaml\|LocatedFragment" packages/lore/src/service/context-fragments/expand.ts` → no match.
- A test asserts that a fragment whose frontmatter uses flow-style YAML (e.g. `audience: [main]` on one line) reports the exact file line of a bad `{{lore:x}}` — RED before the change (record expected-fail at that moment), green after.
- AC-CV-2 and AC-CV-3 commands exit 0; `bun run typecheck:core && bun run typecheck:lore` exit 0; every listed test file exits 0.
