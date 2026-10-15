---
id: KN-561
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-25
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 6 next steps = 11 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | GOAL ANCHOR, hand-written because lore handoff HAS NO --goal field (that gap is issue #5): the project is prd-lore-internal-first-ai-team-knowledge-platform, created 2026-06-07, v76, goals G1-G13, horizon 9-12 months internal-first. Today is day 79 = 22-29% of its own timeline@0.95 | — |
| KD2 | S4 LANDED AND IS LIVE: a deferral reason with no destination no longer closes a ticket item. spec-resume-coverage-floor-the-satisfaction-boundaries-a v18; AC-RCS-1/3/4 attested via lore verify; falsifier exercised red-green; shipped assets/ prose updated so consumers get it@0.95 | — |
| KD3 | LEDGER: 10 open plans, three tiers. Tier 1 = 4 plans with ALL ACs attested needing one final step each. Tier 2 = 2 plans each needing one AC. Tier 3 = 4 plans / 19 tasks unstarted, two of them ZERO evidence over 20 ACs. Closing tier 1 takes open plans 10 to 6@0.9 | — |
| KD4 | THROUGHPUT fell, backlog did not grow: W26-W31 created 114 plans and closed ALL. W32-W34 created 32, left 10 open, weekly task output 250 to 40 — one sixth of peak. Cause NOT measured; hypotheses are thicker per-task governance and the defect channel drawing work out of plans@0.6 | — |
| KD5 | Three measurement errors, each caught only by re-checking: git diff main..branch made a 3-file commit look like 761 deletions; piping bun test to tail measured TAIL's exit 0 while bun said 2 fail and destroyed the detail; I claimed 61 unowned defects vs the real 33 filed + 31 loose@0.95 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: PUSH BLOCKED ON A DECISION, main 7 ahead of origin: main carries ONE red not mine — packages/lore/src/store/CLAUDE.md 14835 bytes vs a 14746 ceiling, from another session's commit 5cb9b905. Filed as issue #10. Not edited: it is that session's live anchor. They evict, or the user authorizes me
- NS2: CLOSE TIER 1 NEXT, cheapest real progress. plan-close-the-read-side-a-github-filed-defect-becomes needs an attested full-suite pass (last row is a self-reported fail, 4000-byte tail, cause unreadable — issue #13). plan-land-the-github-intake-defect-channel-runner-cap-removal needs one --force run
- NS3: TIER 1 other half: plan-land-m7-an-adopted-state-that-frees-defect-channel-quota needs the AC-DC-9 vs AC-DC-14 conflict settled (a decision, not a test run). plan-close-the-two-bootstrap-fixpoint-follow-ups-one-anchored needs two machine-proven reds for AC-BFI-14 and AC-BFI-15
- NS4: USER DECISION PENDING, asked twice: ~/.claude/CLAUDE.md says 'lore ac add|set demotes an approved spec to draft'. FALSE for ac add — ac-service.ts:15 says addCriterion logs without demoting, only setCriterion demotes; measured this session. Correct the line, or file it as an issue
- NS5: ASSETS PARITY UNVERIFIED ON THE SURFACE THAT COUNTS: 423 asset tests pass, but I never ran a FRESH CONSUMER INSTALL (lore init + lore setup in a throwaway dir) to confirm the shipped snippet a new project gets carries the destination rule. Per this repo's own fix contract that is the settling test
- NS6: THE 31 LOOSE ADHOC TASKS ARE ACCOUNTED NOWHERE: extra.adhoc, no plan_id, not issue reports, so lore ready shows them to no plan and the tier ledger excludes them. 144 siblings are archived so the pool drains, but nothing reports its size. Maybe by design — decide before filing (issue #5 thread)
