---
id: KN-500
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-079
---
# Handoff — agent:main-orchestrator

SCOPE: 8 decisions + 6 next steps = 14 items to account for

## Plan

plan-land-oracle-executability-the-discovery-refusal-primitive

## Task Refs

(none)

## Modified Files

- packages/lore/src/adapters/cli/evidence-precheck.ts
- packages/lore/src/adapters/cli/commands/evidence.ts
- packages/lore/src/adapters/mcp/tools.ts
- packages/lore/tests/unit/adapters/evidence-precheck.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | AC-OX-12 landed: findCapturedFailDiscoveryRefusal in evidence-precheck.ts, wired into BOTH the CLI --capture branch and MCP lore_evidence_add. Shape is refuse-loudly (VALIDATION_ERROR/exit 4), not silent inconclusive — inconclusive is not an accepted --result value | 97 |
| KD2 | Task archived, spec re-approved v22, falsifier declared and its find-string verified live and unique at evidence-precheck.ts:1200. Plan now 5 ready / 6 archived | 99 |
| KD3 | lore done REFUSED the filtered AC command (-t) and demanded an UNFILTERED run of the anchored file. Correct: the AC's oracle proves 8 of 66 tests. Recorded 66/66 via --capture, then done passed | 99 |
| KD4 | main is RED at check-anchor-coverage, NOT from my merge: spec-a-falsifier-s-scratch-worktree-must-be-runnable-and has no code_anchors and no ledger row. Its session is STILL LIVE on that plan's next task, so the debt is mid-plan | 96 |
| KD5 | 18 vitest failures across 4 files (mirror parity x2, anchor coverage x2) are live-corpus drift from that same concurrent plan. My diff touched 4 files, none under scripts/, docs/requirements/, or the ledger | 95 |
| KD6 | bun suite's 7 failures were ALL one cause: stale dist/lore. After bun run build the same 7 files pass 90/90, exit 0. Rebuild is part of landing a merge | 99 |
| KD7 | mirror:export exits 0 and prints OK for all six types while stating 'file CONTENT is not compared' — SPEC-130's body edit never reached its mirror. It DOES rewrite on frontmatter change, which hides the defect | 98 |
| KD8 | Harness background notifications reported 'exit code 0' twice for runs that exited 1 and 143. The notification reports the WRAPPER; only the real exit written into the log was true | 99 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-A: 5 ready tasks remain. task-clear-the-29-criterion-pass-unfalsified-backlog-across is still BLOCKED as written (handoff 110's measurement) — do not execute it verbatim
- NS2: NS-B: AC-OX-12's review advisory is unaddressed: its REQUIRED outcome is disjunctive (refused loudly OR recorded inconclusive), so two incompatible implementations both pass. Shipped behavior is refuse-loudly; tightening the AC is a post-hoc spec change needing explicit re-baseline
- NS3: NS-C: the RED row on task-wire-the-discovery-refusal-guard carries no ac_ref and there is no retroactive writer, so AC-OX-12 coverage understates its evidence. Gap 2 of knowledge-four-gaps-measured-while-landing-the-discovery
- NS4: NS-D: defect channel 10/10 full. The citty --description-leading-dashes defect has NO corpus record and cannot be filed. Freeing a slot means deciding if task-lore-verify-falsify-compares-only-the-exit-code-so-an is closable: false-red half IS fixed, unrunnable-scratch half is NOT
- NS5: NS-E: worktree agent-abd191b6d22225bd7 is merged (6d4dc7db) and unlocked, but belongs to the still-live falsifier plan — confirm with that session before removing
- NS6: NS-F: root CLAUDE.md 202/220 lines, 23803/24576 bytes. Still at the eviction floor; any new standing lesson needs a paired eviction
