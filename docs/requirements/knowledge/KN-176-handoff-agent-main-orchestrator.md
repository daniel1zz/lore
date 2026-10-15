---
id: KN-176
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-10
updated: 2026-10-10
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

- packages/core/src/attestation-completeness.ts
- packages/core/src/oracle-file-existence.ts
- packages/core/src/index.ts
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/src/service/checkpoint-registry.ts
- packages/lore/src/service/corpus-service.ts
- packages/lore/src/service/tree-check-service.ts
- packages/lore/src/service/ac-service.ts
- packages/lore/src/adapters/cli/evidence-precheck.ts
- packages/lore/src/adapters/cli/commands/ac.ts
- packages/dashboard/tsconfig.e2e.json
- packages/dashboard/tsconfig.tests.json
- package.json
- CLAUDE.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All 8 dispatched tasks closed: merged, attested-verified, done, worktrees cleaned to zero. On merged tree 2bafec9e with a fresh build, BUILD/TEST/TYPECHECK persisted exits all 0 (vitest 484 files/8597 passed, bun 1873 pass/0 fail); all 3 armed gates re-run on the NEW binary exit 0 | 95 |
| KD2 | The corpus's 4 'genuine reds' were ALL false. AC-061-7/062-3/062-5 named paths with NO git history; AC-064-7 was already green. Real defect count 0, not 4. Root cause landed as findDiscoveryRefusal + its exit-nonzero call site: a discovery refusal now records inconclusive, never fail | 95 |
| KD3 | CENTRAL FINDING: an attested pass is not evidence of production wiring. Three instances of one AC-design defect, ALL found after attestation (AC-TC-1, AC-GV-1, AC-OX-9); 2 by lore assess, 1 by the implementer himself. All three were my AC/anchor design failures, none an execution failure | 95 |
| KD4 | lore assess is load-bearing, not advisory-in-practice. Two plans looked complete by every counter — all tasks archived, every AC attested — and assess rated both a MAJOR outcome gap. All-archived is NOT verified until assess has run and its majors are dispositioned | 90 |
| KD5 | handoff-82 NS3-a and a root CLAUDE.md rule were BOTH false: lore set --status archived DOES evaluate plan-close (corpus-service.ts:2029, default-enabled since 6d1b25f0). Real defect: it passed VACUOUSLY — the source records 4 plans archived on it. Both now corrected | 90 |
| KD6 | lore verify <plan> without --ac/--task runs EVERY declared AC, minting fresh fail rows for unimplemented ones — the exact defect spec A fixes. I avoided polluting the corpus only by filtering every call. Now a standing lesson in CLAUDE.md | 90 |
| KD7 | Declaration-time path validation would have broken red-first TDD (mistyped vs not-yet-written are indistinguishable from the path alone). Resolved as spec A D8: refuse by default, ONE audited escape, made non-silent by counting UNREDEEMED declarations | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: Three ready tasks, none dispatched: task-wire-allow-missing-path-and-the-unredeemed-declaration (plan A), task-assert-the-plan-close-vacuity-discriminator-on-the-render (plan B), task-assert-the-e2e-typecheck-project-s-live-wiring-record-the (plan C). Anchors disjoint — parallel-dispatchable
- NS2: plan A phase-2/3 tasks were never created. corpus-cleanup: correct the 3 mistyped commands + re-attest all 4 reds (AC-OX-6). backlog-and-arm: clear the 29 pass_unfalsified (19 script via reverse control, 10 human by hand), AC-OX-7 population union, then arm the gate
- NS3: pass_unfalsified_count is still 29, measured this session. Read it from lore status --json, never a literal in a doc. Of the 19 script-mode ones, FIVE carry no path token at all, so declaration-time validation is structurally silent on them (AC-OX-4 asserts that limit)
- NS4: ⛔ Do NOT close any of the three plans yet. Each has 1 ready task and an assess MAJOR either open (A: never assessed) or dispositioned-into-a-task-but-unfixed (B, C). Assess plan A before considering closure; re-assess B and C after their fix tasks land
- NS5: Three tooling gaps still have NO owning spec, all in knowledge-four-governance-tooling-gaps-measured-while-resuming: G1 only spec-create is feedable so 3 of 4 gates are not; G2 status reports the count but nothing lists WHICH; G5 the spec mirror misses 41 of 141 with no export script
- NS6: Root CLAUDE.md is at 196/220 lines, 21224/24576 bytes — 24 lines of headroom and already emitting an approaching-ceiling advisory. The next standing lesson likely needs an eviction first; lore governance claude-md prints the contract
- NS7: A3 flagged that ac-set.test.ts was edited outside its anchors (required by AC-OX-4's own oracle), and B1 that 15 pre-existing assertions in two non-anchor files needed the new isolation idiom. Both reported not hidden — but both mean the anchor sets under-declared their blast radius
- NS8: B1 added assessmentFreshnessExempt:true to 7 existing fixtures to keep the newly-visible no-evidence entry out of their verdict counts. assess flagged the net effect: the suites most focused on counting verdicts no longer exercise the new path. Folded into plan B's ready task
