---
id: KN-248
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-10
tags: []
parent: PLAN-086
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 7 next steps = 13 items to account for

## Plan

plan-implementation-resume-ticket-coverage-floor-blocking

## Task Refs

(none)

## Modified Files

- packages/lore/src/adapters/cli/commands/handoff.ts
- packages/lore/tests/unit/handoff-coverage-check.test.ts
- packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Three original defects fixed and attested: 8/8 AC-RCH pass under lore verify; arming now keys on the producing tool_use so cat-ing an archived handoff no longer arms; the verdict travels the Stop stdout block channel at exit 0 | 95 |
| KD2 | The 5 bun failures were shared-checkout concurrency artifacts, not regressions: isolated runs pre- and post-change are identical at 1662 pass / 0 fail, and surviving vitest failures belong to a concurrent session | 95 |
| KD3 | lore assess must run AFTER every evidence record lands: acting on its advice to record the full suite invalidated that assessment via plan-close ASSESSMENT_STALE, costing an extra judge run | 90 |
| KD4 | For the undefined sidechain rule the recommended shape is asymmetric: arm from any chain, satisfy only from the main chain, so a subagent cannot shadow-discharge an obligation the operator never reads | 75 |
| KD5 | An empty deferral reason closes an item because deferred: satisfies its own prefix check, while SPEC-112 D5 and the verb's own printed instruction both require a reason | 95 |
| KD6 | The last-task advisory firing while a sibling was still draft contradicts computePlanNowFullyTerminal after excluding three hypotheses, but is NOT confirmed | 50 |

## Failing Oracle

(none)

## Next Steps

- NS1: Open the next slice covering BOTH remaining arming boundaries in one predicate change: the sidechain rule and the MCP namespace collision where mcp__other__lore_feed arms because only the last __ segment is compared
- NS2: Enforce a non-empty deferral reason in the disposition parser with an AC; the adjacent bare-deferred rejection is already green so only the empty-reason case is open
- NS3: Fix the evidence output_tail so a pass record witnesses its own criterion: prefer the tail slice matching the AC id over the literal end of the stream
- NS4: Close the change-selector blind spot for spawn-style tests: union import-graph with path affinity, or make a non-empty diff selecting zero test files a loud failure
- NS5: Compress root CLAUDE.md: it sits 5 bytes below max_bytes, so no standing lesson could be added and the next increment of any kind fails the ceiling check
- NS6: Reconcile the lore evidence oracle-file precheck with lore verify execution: the same cd-bearing command is rejected by one surface and executed by the other
- NS7: Reproduce the last-task advisory timing in a throwaway corpus (plan plus one archived task plus one draft task, then lore done the first) to confirm or dismiss it
