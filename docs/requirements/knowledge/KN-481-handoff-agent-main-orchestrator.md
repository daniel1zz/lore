---
id: KN-481
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-20
updated: 2026-10-10
tags: []
parent: PLAN-131
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 8 next steps = 15 items to account for

## Plan

plan-close-the-two-bootstrap-fixpoint-follow-ups-a-ledger-test

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Both follow-up plans CLOSED through the live plan-close gate. Tree drift 11 -> 1; 5 of 6 pre-push checks green, the sixth is that one drift | 98 |
| KD2 | Three of my own ACs were unattestable BY SHAPE. One root: a naive path tokenizer in three code paths. Splitting by RUNNER works - all four split ACs attested first try | 97 |
| KD3 | lore assess caught a non-discriminating falsifier TWICE, both times AFTER attestation and archival. Attestation proves exit 0, never that the assertions inside can fail | 96 |
| KD4 | AC-TC-4's own fix regressed six tree-scan oracles by returning on first scope match. Closed one under-selection hole, opened a wider one, same commit. Probe-confirmed | 97 |
| KD5 | The anchor-coverage ratchet was exit 1 for EVERY session since 2026-08-17, naming the spec the same window created. Dispositioned as debt; now 60 of 60, exit 0 | 99 |
| KD6 | Defect channel at its 10-open cap, so gaps 5-8 could not be filed. I TESTED two for staleness - both still valid. No honest way to free a slot | 98 |
| KD7 | Three subagents stalled at the 600s watchdog. Two recovered via short resume over an intact worktree. One had measured a red and only described it - I made it re-measure | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: THE REMAINING DRIFT: plan-land-oracle-executability has 2 of 3 phases holding ZERO tasks. Decompose (/lore-plan) or lore phase rm. Not mine to decide; handoff 108 NS2 said decompose. Filed as 01KZWYPEQBTCT8XF72D29R7X4Q. pre-push stays red until it moves
- NS2: AC-BFI-10's independence rests on HAND-COPIED SQL: the test duplicates check-anchor-coverage.ts's live-spec population and anchored predicate, nothing binding them. Fix: export the predicate from a shared module both import
- NS3: AC-BFI-13 carries its red as DECLARED UNMEASURED DEBT. Forcing it needs a throwaway-corpus fixture owning its own spec and anchor, since the only anchor under test lives in this repo's corpus
- NS4: Fix the tokenizer root: countExplicitPathArgs in packages/core/src/attestation-completeness.ts plus the ac-add declaration precheck. One fix removes all three manifestations. Scope the count to the runner segment, or REFUSE unknown shapes instead of under-matching
- NS5: Gaps 5-8 live only in knowledge-four-governance-gaps-measured-while-resuming-handoff, which no --check reads. The report-immediately discipline has degraded from enforced to advisory with nothing announcing it
- NS6: PENDING: git worktree remove .claude/worktrees/agent-a69a248ab07198c1f then git branch -d worktree-agent-a69a248ab07198c1f. Safety gate refused at 19.5 min of reflog quiet, needs 30. Clean, merged, 0 ahead
- NS7: AC-TC-1 and AC-TC-2 carry 0 tagged records. Both commands DO run green (selector 62/62, typecheck exit 0 tagged to AC-TC-3). Attribution gap, not capability - do not read as untested
- NS8: Root CLAUDE.md: 201/220 lines, 23317/24576 bytes, 19 lines headroom. A subagent reported 300/30720 - wrong. Read lore status --check-claude-md, never a remembered figure
