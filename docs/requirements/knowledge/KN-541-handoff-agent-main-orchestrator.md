---
id: KN-541
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-142
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 9 next steps = 13 items to account for

## Plan

plan-land-the-adr-s-phase-write-decision-a-red-first-parity

## Task Refs

(none)

## Modified Files

- docs/requirements/adr/ADR-038-phase-writes-log-a-version-row-and-do-not-demote-t.md
- docs/requirements/plan/PLAN-142-land-the-adr-s-phase-write-decision-a-red-first-pa.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | NS1 DELIVERED. Owner answered S2: log a version, do NOT demote -> adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan, approved, relates-to linked from SPEC-148. SPEC-148 revised v10->v35: write path in scope, 3 ACs pinned@0.9 | — |
| KD2 | The ADR rests on a measurement WITH A GREEN CONTROL: phase add/rename/rm all left an approved plan at approved and lore log at 2 rows, while set --content demoted to draft and went to 3. renamePhase is now MEASURED, closing D4@0.95 | — |
| KD3 | SPEC-148's ACs took FIVE review passes, each finding a real defect. Worst: a candidate regex that MATCHED THE FALSE TEXT it existed to delete (measured 1 against that line) - green-on-arrival, zero discriminating power@0.85 | — |
| KD4 | bun run mirror:export -- --dry-run WROTE THE FILES. export-spec-mirror.ts:425 parses only --check; all other flags fall through to the write. The incoming ticket's NS7 came from this same call, so two sessions were misled alike@0.95 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1 FOLLOW-ON, NOT DISPATCHED, needs your go-ahead: plan-land-the-adr-s-phase-write-decision-a-red-first-parity is approved; lore ready reports 2 records, 2 ready===true, 0 ready===false. Phase 1 = author the parity suite (anchor: the new test file only, ac_scope empty, red-first expected-fail evidence). Phase 2 = insertVersion in all three writers (anchors: phase-service.ts, ac-service.ts, CLAUDE.md; claims all 3 ACs). Sequential with disjoint anchors on purpose, so phase 2 cannot edit the suite judging it
- NS2: BLOCKER on dispatching PHASE 2 specifically: CLAUDE.md is one of its anchors and a peer session has UNCOMMITTED changes to CLAUDE.md in the shared working tree. The anchor gate cannot see working-tree state, so the mutex it promises is absent for that file. Confirm the peer landed first
- NS3: NS6 re-measured: origin/main..main went 63 -> 2 -> 4 during this session because the peer PUSHED. Still nonzero, so worktrees are cut from a stale origin/main. Both task bodies pin git rebase main plus a HEAD-alignment recheck; do not relax that to a pull
- NS4: NS3 STILL RED, NOT MINE, re-measured: bun scripts/check-anchor-coverage.ts exits 1 on spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired (no anchors, no ledger row). pre-push stays red until the peer disposes it
- NS5: NS4 STILL RED, NOT MINE, re-measured on the peer's newer main: bun run typecheck exits 2, 3 errors all in packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts - TS2339 x2 on SyncSubprocess.error, TS2322 x1 on a config missing stale_after_days. A red-first test should still COMPILE
- NS6: NS7 IS WORSE THAN THE TICKET SAID: 4 drifted mirrors not 1 - PRD-001, SPEC-147, KN-522, SPEC-148. SPEC-148 IS MINE and I cannot repair it: mirror still carries the v10 body while the corpus is v35, and the export CLI wires no --force, so the only repair would also overwrite the three that are not mine. knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files F2
- NS7: UNCOMMITTED, DELIBERATELY: the phantom dry-run left 8 new mirror files, a +36-line .lore/export-index.json, and an identity_repaired edit to KN-042. Only 4 of the 9 new index rows are mine (ADR-038, PLAN-142, TASK-813, TASK-814); 5 are the peer's. Committing the index would reference their uncommitted files. Coordinate with them, or commit path-scoped after they land
- NS8: NS2 DEFERRED by your scope choice (NS1 only). F3 = flag an index-section list item carrying no resolvable slug; F4 = code-derive or test-diff the Document Lifecycle fenced block against schemas.ts VALID_TRANSITIONS. Prose fixes landed last session; the mechanism is missing and still has no spec
- NS9: TWO ROOT-CLAUDE.md ONE-LINERS ARE OWED, unwritten because the peer holds uncommitted edits to that file: (a) --dry-run is not a real flag on mirror:export and writes anyway; (b) a negative-only prose oracle needs a positive counterpart. Both resolve to knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files
