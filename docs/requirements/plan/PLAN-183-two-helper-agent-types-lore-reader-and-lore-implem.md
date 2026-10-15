---
id: PLAN-183
type: plan
role: plan
title: "Two helper agent types: lore-reader and lore-implementer"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: SPEC-178
phases:
  - {name: "W1"}
  - {name: "W2"}
  - {name: "close"}
---
## Goal

Land `spec-two-helper-agent-types-lore-reader-and-lore-implementer` (ADR `adr-helper-agent-types-split-only-on-mechanism-enforced`).

## Phases

| Phase | Task | ACs |
|---|---|---|
| W1 | T1 agent definitions, dispatch hooks, setup retirement test | AC-AT-1, AC-AT-2, AC-AT-3, AC-AT-6 |
| W2 | T2 fragment audiences and skill references | AC-AT-4, AC-AT-5 |
| close | main agent: BASE-030 body sentence, user-local tester.md and user-15 table, full suites on main, lore assess | — |

W1 and W2 run in sequence, not in parallel: both regenerate `packages/lore/src/generated/assets-manifest.ts`.

## Census

The 2026-10-15 census (main agent, read-only explorer) found no hard-coded agent type list in `packages/*/src`; `fragments-flow.ts` `enumerateAgentTypes` reads the agents directory. Test fixtures that only use `tester` or `lore-implementer` as an arbitrary agent-type string (context-fragments select/duplicates/flow fixtures, run-record fixtures) are NOT in scope: they test the mechanism with any string, not the shipped catalog.
