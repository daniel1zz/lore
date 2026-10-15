---
id: TASK-1227
type: task
role: plan
title: "[Skill:implement] Census fidelity: interface calls as not_measured, shared bootstrap list"
status: archived
priority: high
phase: "Phase 2: Indexes and census"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1217, type: blocks}
  - {id: TASK-1216, type: blocks}
---
Estimate: M
Approach: in site-census.ts, a call whose callee resolves to an interface/abstract member with no body is a not_measured site keyed `<Interface>#<method>` (deduplicated per interface method); a shared non-business symbol list (one file, e.g. packages/lore/src/service/site-census-nonbusiness.ts) names app-bootstrap entry points (loadLoreApp, createApp, config loading) whose sites are counted separately as bootstrap and never as gaps; coverage output prints gaps / not_measured / bootstrap counts
Source: spec C1/C2; I4 report; R4b scenarios
Covers: AC-BLS2-5
AC:
- Before editing: record expected-fail of R4b's tests on THIS task
- bunx vitest run packages/lore/tests/unit/service/site-census.test.ts and cd packages/lore && bun test tests/integration/cli/baseline-coverage.bun.test.ts both pass
- `bun run packages/lore/src/index.ts baseline sites "ac exempt"` lists the exemption cap refusal (store insert) as a not_measured interface site — pasted in evidence
- bun run typecheck exit 0
