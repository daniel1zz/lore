---
id: KN-172
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-079
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 8 next steps = 15 items to account for

## Plan

plan-land-oracle-executability-the-discovery-refusal-primitive

## Task Refs

(none)

## Modified Files

- packages/lore/src/adapters/cli/commands/ac.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/lore/src/adapters/cli/commands/set.ts
- packages/lore/src/service/checkpoint-registry.ts
- packages/lore/src/service/corpus-service.ts
- scripts/tests/typecheck-chain-contract.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All 3 handoff-84 ready tasks closed end-to-end: merged, full suite green on merged tree (vitest 487 files/8607 passed, bun 1873 pass/0 fail, typecheck 0), attested via FILTERED lore verify, archived, worktrees+branches cleaned to zero. Tree clean at 490b1527 | 95 |
| KD2 | done-gate refused all 3 first archive attempts: needs an UNFILTERED result:pass per test-file anchor, but EVERY AC oracle here carries -t. An implementer following the ACs exactly cannot produce that row. Gate is correct; AC convention and gate requirement were never aligned | 90 |
| KD3 | 2 of 3 agents met the non-empty-tail rule with a HAND-WRITTEN summary. lore refuses an EMPTY tail and its message says a hand-authored summary is not proof, but the predicate is only tail.length>0. A guard whose message exceeds its predicate is worse than none: both rows PASSED. Fix: --capture | 90 |
| KD4 | Attestation is structurally one-sided: lore verify runs the AC command against the CHECKED-IN tree, but a red needs it temporarily BROKEN, so no attested expected-fail can exist. assess showed attested_fail=0 across 3 plans. BLOCKS backlog-and-arm: clearing 29 now mints 29 self-reported reds | 90 |
| KD5 | lore feed <unregistered checkpoint> prints unknown-checkpoint and EXITS 0, so 'lore feed spec-promote && next' proceeds as if fed; the same binary exits 2 for a missing arg. The silent-zero is sharper than the coverage gap it hides; adding checkpoints alone leaves future unknown names silent | 95 |
| KD6 | assess is load-bearing, 3rd confirmation: plan A 70/100 partially_met with 2 MAJORs (AC-OX-6/7 have no evidence, phases 2-3 never created); plan B 88/100 met after its MAJOR was fixed; plan C MAJOR closed, 4 new minors. All-archived counters read complete for all three | 90 |
| KD7 | handoff-84 NS6 named the wrong file: root CLAUDE.md is WITHIN budget (196/220 lines, 21224/24576 bytes, no advisory). The 2 advisories belong to packages/core/src/CLAUDE.md (1403 bytes left) and adapters/cli/CLAUDE.md (1575 left). Eviction is owed THERE | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: spec-falsifiability-reachability-a-feedable-checkpoint-an created (draft, 7 ACs AC-FR-1..7, covering G1/G2/G4/G5/G6). NOT promoted, NO plan yet. Promote it, then create the plan. AC-FR-2/3 (attested-red) are the prerequisite for plan A backlog-and-arm
- NS2: NS2: all 7 ACs declared with --allow-missing-path against unwritten oracle files; lore status --json reports unredeemed_allow_missing_path_count=7, counted per DECLARATION not per file (5 files, so attested-red.test.ts redeems 2 at once). Creating each file drops the count, no command needed
- NS3: NS3: plan A phase-2 (corpus-cleanup: fix 3 mistyped commands, re-attest 4 false reds) is blocked by NOTHING and has no task. Phase-3 IS blocked on AC-FR-2/3. pass_unfalsified_count re-measured this session: still 29
- NS4: NS4: do NOT close any of the 3 plans. B has a REAL bug: corpus-service.ts writes PLAN_CLOSE_VACUITY_NOTICE_FIELD only on the vacuous branch and never removes it, so a later MEASURED satisfied close still reports vacuous. C: AC-TC-2 oracle is absence-only, deleting the whole comment passes it
- NS5: NS5: G7/G8 have no owning spec. G7: the spec-create PreToolUse hook analyses COMMAND TEXT, so --content with a shell substitution was denied MISSING_SKELETON while --content-file passed identical bytes; fail-closed, but it teaches re-spelling as the way past a gate. G8: lore ac set re-runs D8 and OVERWRITES the allow-missing-path reason on every statement edit
- NS6: NS6: assess's own recommendation on plan C (require an attested expected-fail per AC before archiving) is currently IMPOSSIBLE -- it needs AC-FR-2 first. Do not dispatch it standalone
- NS7: NS7: eviction owed on packages/core/src/CLAUDE.md and packages/lore/src/adapters/cli/CLAUDE.md, NOT root. No standing lesson was added to root this session; findings live in knowledge-attestation-is-structurally-one-sided-lore-verify-can (G1-G8, v11)
- NS8: NS8: dispatch bundles MUST prescribe 'lore evidence --capture' and MUST require one unfiltered whole-file run per declared test-file anchor. Both omissions cost an orchestrator round-trip on all 3 tasks this session
