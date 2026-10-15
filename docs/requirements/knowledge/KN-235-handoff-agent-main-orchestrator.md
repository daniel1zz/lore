---
id: KN-235
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 6 next steps = 13 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | NS4 was not a shared-matcher bug. Measured: only g1 denies --help, because g1 alone has a predicate needing no resolvable doc id. Scope went from 4 files to one parity pair@high | — |
| KD2 | NS3's proposed mechanism would have made things worse: expected-fail already exists for deliberate REDs, so requiring plain fail rows manufactures the exact misrender T3 measured@high | — |
| KD3 | NS3 q3 settled, and it found a NEW defect: lore ready renders expected-fail as a green check (ready.ts special-cases only fail). FALSE GREEN, filed and linked as an NS3 blocker@high | — |
| KD4 | NS1 was half-built: the startup exclusion already exists in classifyConcurrencyOutcome. Live gaps are classifyForcedContentionOutcome (false RED) and MIN_CONCLUSIVE_RUNS=20@high | — |
| KD5 | 3 of NS5's 4 gaps were bundle-visibility artifacts, not defects: diff never passed, ledger citations never shown, counter monotonic by construction. Reconciled exactly at 2216 rows@high | — |
| KD6 | The judge returned escalate AND approve on the identical doc version; D5 makes any escalate a hard block, so one coin flip locks a version until the doc is edited@medium | — |
| KD7 | Content past the judge truncation window generates recurring phantom blocking questions. Moving D7 into Design Decisions is what cleared them. Section order is governance@medium | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Dispatch task-discharge-d7-in-code-the-forced-contention-control-cannot (HIGH, anchored, implements-linked to SPEC-072). Held back deliberately: its AC-IC-1 harness spawns 100+ processes and must not run beside another heavy suite
- NS2: Fix task-lore-ready-renders-an-expected-fail-evidence-row-as-a (HIGH) BEFORE building NS3 enforcement, else mandating deliberate-RED rows manufactures false-green readiness lines. Reuse the markers lore ac list already ships
- NS3: NS3 questions 1 and 2 remain open: where the check lives (prefer a deterministic gate over the advisory judge), and how a task declares it claims red-first (machine-readable, never inferred from prose). Question 3 is closed
- NS4: Four NS5 mechanism tasks await: lore assess deriving the plan's own commit set (measured 6 of 13 commits foreign in the naive range), the compound AC-ACS-1/4 split, echoing the exemption reason in detector output, unfiltered-run attestation
- NS5: Decide the judge-flakiness direction from flip-frequency evidence, not the single observed pair. Direction b (N consecutive escalates, or explicit human dismissal instead of a doc edit) preserves intent without rewarding re-rolls
- NS6: Stale branch worktree-agent-ada3640f23484b4b5 still needs a manual git branch -D: the safety gate correctly refuses it and its only commit is a superseded generated manifest. Two foreign worktrees remain and are not mine to remove
