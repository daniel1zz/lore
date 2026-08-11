---
id: KN-245
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-085
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 6 next steps = 10 items to account for

## Plan

plan-implementation-lore-ac-set-the-dangling-ac-ref-detector

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | lore ac set shipped — third instance of the writer-verb gap family (after lore outline exempt, lore plan exempt-attestation). No longer argued but measured: a probe found 3 real dangling ac_ref (AC-CP-3/5/7) produced by the rm+add cycle it replaces@high | — |
| KD2 | This plan closed by SATISFYING both plan-close conjuncts, not widening them — direct contrast with handoff-52 KD1/KD2, where the conjunct was merged away and 4 plans closed through the hole. T3 declared real ac_scope and earned attestation; SPEC-038 was truly re-synced@high | — |
| KD3 | I deliberately armed a gate that would have been vacuous: linking the spec to SPEC-038 via implements turned prdOutlineSynced from NOT-APPLICABLE into a real conjunct I then had to satisfy. I7b applied to my own work, not only judged in others'@high | — |
| KD4 | Two false oracles fired on ME, both caught only by adversarial re-check: (1) ac set's first real call said 'Unknown command set' — source had it, dist/lore did not; (2) a sha256 parity check printed SAME because ~/.claude path is a symlink to the same inode@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: task-ic-spec-discharge-the-startup-write-contention-gap-ac-ic-1 (HIGH) is now UNBLOCKED — it waited on lore ac set, which shipped. Closes V3: AC-IC-1/AC-IC-2 classify a startup-phase refusal as failure though the spec documents contention starts at startup
- NS2: task-the-approved-to-draft-demotion-rule-is-mirrored-in-ac (HIGH): the D2 rule now exists TWICE (corpus-service isApprovedAutoResetToDraft + ac-service computeSetStatus). Implementer flagged it honestly. Fix = extract to @lore/core beside VALID_TRANSITIONS, not a cross-service import
- NS3: task-red-first-discipline-is-asked-for-in-prose-but-never (HIGH), from this plan's assess: T1 DID run red-first but recorded no result=fail row, so the corpus cannot prove it; T2 did. Settle its question 3 (append-only log + checkmark aggregation) BEFORE building
- NS4: task-g1-spec-create-gate-denies-lore-create-spec-help-with: g1 denies 'lore create spec --help' with PARENT_REQUIRED. Measure g2/g3/g4 for the same shape first — they share the matcher. Fix lands on assets/hooks, not this repo's hooks/ copy alone
- NS5: 4 remaining assess gaps in knowledge-assessment-implementation-lore-ac-set-the-dangling-ac: compound ACs (AC-ACS-1/4 each assert two things under one oracle), unfiltered-run attestation, and scanned-row drift 2191->2215 never reconciled in writing
- NS6: NOT MINE: plan-implementation-ac-scope-admission-at-task-creation belongs to a concurrent session. Its task-create gate landed mid-session and correctly broke T2's fixture. Do not adopt without checking with that session
