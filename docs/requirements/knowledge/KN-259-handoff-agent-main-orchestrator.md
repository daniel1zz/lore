---
id: KN-259
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
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
| KD1 | NS1 DONE: 30 attested entries across 9/10 evidence-bearing tasks of the four 0.00 plans. Sanctioned path = --task + explicit --ac (ABSENT ac_scope + --ac = D2's escape, verify-runner-service.ts:454). A plan-wide run both refuses AND is the catalogued false pass@high | — |
| KD2 | Plan2 T1 unrecoverable: 6 rows all oracle=manual citing /tmp probe scripts long gone, zero ac_ref. Took a typed exempt-attestation --kind no-oracle over synthesising an AC association it never claimed@high | — |
| KD3 | 6 of 7 ad-hoc tasks landed+archived. Each reverse-verified by me, not self-report: ledger perturbation gave exit 2/5/0, ad-hoc verify gave a loud exit-4 with repair hint, claude-md dogfooded on the real 24571/24576 file@high | — |
| KD4 | NEW false-oracle vector contradicting the catalogued one: vitest -t matching nothing exits 0 with ZERO tests run. Lesson 1's 'zero-match is loud' holds for PATH filters ONLY. Live AC-TB-2/3/5 all ride -t, one rename from permanent green@high | — |
| KD5 | git branch --merged listed all 5 worktree branches as merged while 4 had ZERO commits (dispatch base = trivial ancestor). Cleaning by it would have deleted 4 live agents' workspaces. Gate on git log main..<branch> + a completion report@high | — |
| KD6 | Anchor-mutex hole: eps' ledger DATA cited line numbers inside delta's file. Zero conflict, zero anchor overlap, yet delta's pure insertion shifted a violation 92->133, breaking the ledger as orphaned-row AND new-debt at once. Only the post-merge full suite saw it@high | — |
| KD7 | V5 was correctly REJECTED by the judge on attempt 1: I added AC-TB-6 asserting an exit taxonomy and ledger schema that no section of the body designed. Landed only after adding D6/D7. The judgment gate earned its keep@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS2 remainder: task-spec-first-require-ac-scope-at-task-creation-so-the-runner is the ONE ticket item still unstarted, deliberately — it is SPEC-FIRST, needing an approved tech spec before code. Its body carries a premise the gamma implementer measured as FALSE ('ad-hoc has no plan therefore no spec')
- NS2: Two tasks filed this session, unstarted: task-adjudicationbar-s-compact-status-chip-still-derives-from (HIGH, the two dashboard surfaces now disagree with EACH OTHER) and the ac_ref gap task (HIGH, ad-hoc attested rows cannot carry ac_ref, so spec coverage reads uncovered for ALL ad-hoc work)
- NS3: NS5 premise was FALSE (measured): context-verb-family has 12 ready tasks, lifecycle-archival has 1. They are NOT awaiting closure — a close exemption now would be wrong sequencing. Resume as ordinary implementation work
- NS4: NS6 half-closed: saturation is MECHANIZED (check-claude-md now reports used/ceiling/remaining + a config-driven near-ceiling advisory, exit unaffected). It surfaced store/CLAUDE.md at 129 bytes left, http 1478, ai 1539. Eviction policy still UNDECIDED; root file still at 5 bytes, zero added this session
- NS5: Recommended, NOT built: assert executed-test-count >= 1 after any filtered AC command, at the lore verify layer where false-oracle vectors 1-4 already live (runner summaries are already parsed there per AC-061-11..17)
- NS6: Recommended, NOT built: key ledger rows on a content fingerprint of the test title instead of a line number — removes the insertion failure class rather than reporting it faster
