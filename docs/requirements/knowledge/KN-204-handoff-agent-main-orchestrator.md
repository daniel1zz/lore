---
id: KN-204
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 7 next steps = 14 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- CLAUDE.md
- packages/lore/src/adapters/cli/CLAUDE.md
- packages/core/src/config.ts
- packages/core/src/attestation-completeness.ts
- packages/lore/src/service/phase-workflow-service.ts
- packages/lore/src/service/session-service.ts
- packages/lore/src/service/corpus-service.ts
- packages/lore/src/service/plan-membership.ts
- packages/lore/src/adapters/evidence-capture.ts
- packages/lore/src/adapters/cli/evidence-precheck.ts
- packages/lore/src/adapters/cli/commands/evidence.ts
- packages/lore/src/adapters/cli/commands/create.ts
- packages/lore/src/adapters/cli/commands/verify.ts
- packages/lore/src/adapters/cli/commands/gate.ts
- packages/lore/src/adapters/cli/create-task-validation.ts
- packages/lore/src/adapters/cli/phase-wiring.ts
- scripts/check-plan-membership-sites.ts
- scripts/check-ordinal-write-sites.mjs

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Tier 1 wave 1 landed 6/6 on clean main 6788989: TYPECHECK 0, TEST 0 (vitest 458 files/8156 passed, bun 1793 pass/0 fail), six check:* guards exit 0 — measured WITHOUT a pipe. Open 35 -> 32: the session's first net-negative wave | 100 |
| KD2 | ⛔ CAVEAT: that green assumed CLAUDE_CODE_SESSION_ID was SET. gate-p2-cross-tier.bun.test.ts has a case keyed on that ambient var (with it 22 pass/exit 0; env -u it 21 pass/1 fail). Production is correct both ways; the ORACLE is not | 95 |
| KD3 | The post-merge suite earned its keep: 6 bun failures appeared ONLY after merging two branches each green in isolation. The 11th-site fixture called --adhoc without --ac-scope; the ac-scope slice made that exit 4, and neither agent could see the other | 100 |
| KD4 | ADR D2 corrected at v2: its cost rule stands, its implied benefit does not. check:plan-member-sites hit exit 0 and the family at once produced sites 12 and 13, both invisible to R1/R2/R3. Guard exit 0 means no instance of the matched SHAPE | 95 |
| KD5 | The capture-window slice refuted its own task doc: the hedged 'possibly the 600s timeout' string was unreachable dead code — spawnSync ALWAYS sets error on timeout — and status===null was never sound. Detection keys on ETIMEDOUT OR monotonic elapsed | 95 |
| KD6 | KD6 corrected: requiresNoNewTestsDeclaration short-circuits on ac_scope.length===0 (task-workflow-service.ts:757), so --ac-scope '' — now the ONLY way to make an ad-hoc task — still escapes the red-first floor | 95 |
| KD7 | Two agents widened past their anchors; both ACCEPTED after my independent checks — additive-only core changes forced by AC-061-14's scan, and the phase-claim wiring plus gate parity, measured load-bearing. My 'STOP, never widen' rule was too absolute | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: Wave 2 lead is task-capture-source-is-optional-at-the-evidence-write-boundary — the ROOT of the self-report family and the largest lever on the confidence interval of guyin's 115 evidence-carrying tasks
- NS2: ⛔ ANCHOR MUTEX for wave 2: active-sessions and plan-member-sites-twelve-and-thirteen BOTH declare session-service.ts; capture-source and a-mistyped-task-file-anchor both declare task-workflow-service.ts. Sequence, never concurrent
- NS3: Remaining Tier 1 per knowledge-d5-re-scope-35-open-tasks-against-the-named-consumer: capture_source root, evidence --ac on an ad-hoc task, active_sessions scoping, mistyped file_anchor, the corpus-workflow injection labelling release as Done, LORE_GATE_BYPASS asymmetry, lore uat record doc-type
- NS4: Three new Tier 1 items filed this wave: task-a-test-s-green-depends-on-an-ambient-claude-code-session, task-plan-member-sites-twelve-and-thirteen-both-structurally, task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed
- NS5: ⛔ Every ad-hoc task still archives via --override-attestation. The re-keying was CREATE-TIME only by decision (ADR D2 rejected extending lore scope for a 4-instance family), so the back-catalogue keeps its ABSENT ac_scope by written exemption
- NS6: root CLAUDE.md headroom is now 63 bytes / 13 lines (24513/24576) after the SPEC-023 correction. ADR D1's standing lesson still cannot land without an eviction
- NS7: Still deferred from the resume ticket, unchanged: NS2 NS4 NS5 NS7 NS9 NS10 and KD4 — reasons in this session's RESUME_DISPOSITION blocks
