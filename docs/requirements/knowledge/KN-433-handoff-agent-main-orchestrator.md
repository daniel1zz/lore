---
id: KN-433
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-122
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

01KZRA6287

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | ⛔ FEED THIS ONE ONLY. Handoffs -91/-92/-93 exist but lore feed does NOT render a handoff's content — measured: four distinct header phrases I wrote into -93's body returned 0 hits in its own feed output. Only --decision/--next survive, so read those three via lore get, never via feed | 98 |
| KD2 | ⛔ -91's NS3 claim that the mirror was re-exported and committed on main is FALSE and I retracted it. mirror:export exits 0, reports parity OK, and does NOT rewrite an existing file's content — identical before/after md5 across a 65-token rename. See GAP-25 | 98 |
| KD3 | ⛔ -91 and -92 both describe agents as still running. NONE are. All five finished; all 10 worktrees and branches removed after an unconditional git log main..branch scan showed zero unmerged commits on every one | 97 |
| KD4 | ⛔ -92 says ai-provider-service.ts has FOUR stale comments. It has SIX: diffSource at :87 :89 :1193 :1199, plus two 'default 24000' near :616 :663 that AC-GD-1's raise falsified. Widen AC-JV-6 | 97 |
| KD5 | ⛔ LIVE RED on main, I verified it myself after a fresh build: migrate-ordinals-compiled.bun.test.ts exits 1, 2 of 5 failing on brandedHumanId(SPEC-1). Commit 63164c20 re-baselined the unit test and left this compiled sibling behind | 98 |
| KD6 | ⛔ Distrust this session's own judgments that name a field, path or exit code. I twice pinned an AC's oracle to something unmeasured — the second time right after adding a CLAUDE.md lesson against exactly that. Implementers caught both, not me | 97 |

## Failing Oracle

(none)

## Next Steps

- NS1: STEP 1 — dispatch task-re-baseline-the-compiled-migrate-ordinals-e2e-to-the. It is ready, undispatched, and fixes the live red. ⛔ Do NOT fix it by reverting the padded human_id composition: AC-MIS-1/2/4 are attested against it and the round-trip idempotency AC depends on it. The PINS are stale, not the code
- NS2: STEP 2 — then the full suite, never run this session and finally safe (no agents, dist/lore freshly built). ⛔ Running it BEFORE step 1 yields a baseline you cannot read: those 2 failures are expected until step 1 lands, so anything else is new. Ordering is load-bearing
- NS3: STEP 3 — GAP-26 (this handoff's first decision) needs recording in knowledge-five-governance-tooling-gaps-measured-while-resuming, and it changes how every future handoff must be written: put nothing load-bearing in the body, because no consumer reads it
- NS4: STEP 4 — re-create the AC-JV-6 task (its first creation was refused: anchor file absent, expected for a to-be-created test), widened to all SIX stale comments; dispatch task-replace-the-false-git-tracked-mechanism-in-the (AC-GD-4, ready); flip GAP-11 to half-closed leaving open_half_carried_by ABSENT so the pinned 8-member set holds
- NS5: STEP 5 — fix GAP-25 as TWO separable things, ⛔ not just the first: (1) exportDocs must rewrite an existing file whose rendered content differs, (2) runCheck must gain a content-hash comparison so a stale mirror is RED. Without (2) the next skip is invisible again
- NS6: STEP 6 — S2's task-make-the-ac-fr-10-mirror-oracle-drive-the-read-only-check needs a genuine quiet period (AC-OX-1 asserts git status --short .lore docs/requirements is EMPTY after its run); then assess S1/S3/S4 plus four older open plans, machine-checking every finding that names a path, then close them
