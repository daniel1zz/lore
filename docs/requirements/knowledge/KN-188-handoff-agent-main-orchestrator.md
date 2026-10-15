---
id: KN-188
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-07
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 5 next steps = 12 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- CLAUDE.md
- packages/lore/src/adapters/cli/CLAUDE.md
- packages/core/src/CLAUDE.md
- packages/lore/src/flows/feed-flow.ts
- packages/lore/src/adapters/cli/get-render.ts
- packages/lore/src/adapters/cli/commands/get.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/lore/src/adapters/cli/commands/context.ts
- packages/core/src/config.ts
- packages/lore/src/service/claude-md-check.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Waves 5+6 closed 5 more tasks (9 this session). Verdicts on clean trees at 35ed6787 and 9b8ab8c4; vitest 476 files/8498, bun 1842 pass/0 fail across 173 files, all four armed gates exit 0 on the MERGED tree with a fresh binary. main now 81c13ad4, zero worktree residue | 100 |
| KD2 | ⛔ On THIS machine the bun runner MUST be batched (9 explicit-file-list chunks). Whole-suite concurrency starves on page-in: ~7 timeout failures per run, DISJOINT sets, never an assertion mismatch, 6803s and 7074s vs a 584s baseline. Coverage identical; no timeout changed | 100 |
| KD3 | Load average is the WRONG instrument for a red suite — it counts RUNNABLE threads, so memory-pressure blocking is invisible. It read 2-10 while a sleep-20 loop was starved to one iteration per 295s. Read vm.swapusage plus free pages instead | 100 |
| KD4 | A newly-armed threshold is calibrated against the arming agent's BASE. A peer doc-synced an unanchored file past it and main went RED on merge — anchor mutex clean, both scoped oracles green. Re-run every armed gate on the merged tree AFTER the rebuild: the verdict belongs to the BINARY | 100 |
| KD5 | Putting the loss notice at the seam alone would have shipped a COSMETIC fix: gate-feeding quotes a leading 800-char slice, so a trailing notice is cut from every production-sized doc, including the 5.6KB one from the original incident. Verify at production size, not fixture size | 100 |
| KD6 | warn-vs-refuse resolved by reading the consumer: claude-md-guard.sh maps 0=allow, 3=block, EVERYTHING ELSE fail-open. A refusal exit code would convert measured-against-wrong-budgets into not-measured-at-all — strictly worse than the silence being removed | 95 |
| KD7 | The consumer-not-seam anti-pattern nearly landed a THIRD time: commands/context.ts held a byte-identical copy of the budget defect, self-documented as mirroring status.ts verbatim, and lore context refresh WRITES CLAUDE.md through it. Demand the parallel-path check | 100 |

## Failing Oracle

(none)

## Next Steps

- NS1: 24 live open tasks (7 high). Best next: task-nothing-cross-checks-a-task-s-file-anchors-against-the (high, mechanizable, its own two blind spots already written into it) and task-lore-ready-s-records-carry-no-validity-signal-so-a (medium, weaker: the FILTER already holds, only the probe signal is missing)
- NS2: Machine hygiene, NOT mine to kill: pid 89203 is a leaked lore dashboard on port 8931 serving a VANISHED temp corpus from an 8-day-old session — the exact shape of the 2026-07-07 corpus-pollution incident. The three dist/lore --mcp-server processes are LIVE sessions including this one; do not touch
- NS3: Memory pressure is from long-lived claude sessions + Chrome (794MB single helper), NOT from lore leftovers (5 lore processes total ~64MB). Until it frees, keep waves at 2 agents and keep the bun runner batched
- NS4: Residuals named but not fixed: feed task-start drops all PASSING verification_evidence rows and most of claim; feed phase-start is weaker still and drops a spec's acceptance_criteria entirely; both drop uncatalogued extra keys silently. Recorded as a pointer in commands/feed.ts, not filed
- NS5: Every --adhoc --ac-scope "" task still needs BOTH a red row and --override-attestation to archive. That is now routine, not exceptional — 9 archived that way this session
