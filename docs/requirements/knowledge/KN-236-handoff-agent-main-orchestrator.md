---
id: KN-236
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-084
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 7 next steps = 13 items to account for

## Plan

plan-implementation-resume-coverage-floor-satisfaction

## Task Refs

(none)

## Modified Files

- packages/lore/src/adapters/cli/commands/handoff.ts
- packages/lore/tests/unit/handoff-coverage-check.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | handoff-55 NS1's sidechain premise REFUTED by measurement: 3,928 transcripts, 427,493 isSidechain:true all under subagents/, ZERO in any main-chain file. Shipped the asymmetry anyway as a tightening against an unstated environment assumption; the harness fact is deliberately NOT an AC | 95 |
| KD2 | NS1's MCP-namespace half REFUSED via accepted ADR: lore setup writes no MCP registration (0 mcpServers hits in assets/), so the alias is consumer-chosen and a full-name match would silently disarm aliased consumers — the silent-inertness mode H4 exists to avoid | 95 |
| KD3 | A probe finalized BEFORE dispatch and never shown to the implementer was the strongest merge oracle: 3 red pre-merge to 8/8 green post-merge, with 4 must-not-block controls plus a sentinel proving arming stayed chain-blind | 95 |
| KD4 | The assess judge gave 2 of 4 findings FALSE against stored corpus data (truncation artifacts it self-reported) and missed the REAL shortfall: both red-first fail rows carry an empty output_tail. Confidence degradation is a signal to re-check, not a discount | 90 |
| KD5 | I created 2 false code-drifts myself by anchoring module-PRIVATE functions — anchor grammar resolves EXPORTED symbols only. Caught by check-drift right after declaring; fixed to a file-level anchor | 95 |
| KD6 | prdOutlineSynced deliberately ARMED rather than left NOT-APPLICABLE (I7b on my own work) by linking the spec to the session-layer domain overview. Cost: a real domain-doc edit plus re-review and re-approve, since a spec content edit demotes to draft | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: Require a non-empty output_tail on every result=fail evidence row — a TaskWorkflowService write-side predicate. Measured: the dispatch bundle asked in prose and the ask was silently dropped on BOTH red-first rows
- NS2: Project evidence rows into the assess bundle as (oracle, ac_ref, result, command, tail_bytes) instead of embedding the whole task doc — 10 rows overflowed it; those two facts would have surfaced this session's real shortfall
- NS3: Suppress based_on=absence findings for any AC whose evidence source was truncated: the rubric ALREADY detects the ungrounded shape (it warned) but still publishes the finding into the permanent record
- NS4: handoff-55 NS3 still open: evidence output_tail should witness its OWN criterion (prefer the tail slice matching the AC id over the literal stream end). Adjacent to but distinct from the empty-tail item above
- NS5: handoff-55 NS4 still open: change-selector blind to spawn-style tests. A concurrent session landed 438976b documenting the integration-CLI tier blindness — read that before filing, the scope may have shifted
- NS6: handoff-55 NS5 still open: root CLAUDE.md at 5 bytes free, filed as task-sweep-the-claude-md-standing-lessons-layer-against-the. A concurrent session was editing that exact file this session — coordinate first
- NS7: handoff-55 NS7 still open and its KD6 stays unconfirmed: reproduce the last-task advisory timing in a throwaway corpus (plan + one archived task + one draft task, then lore done the first)
