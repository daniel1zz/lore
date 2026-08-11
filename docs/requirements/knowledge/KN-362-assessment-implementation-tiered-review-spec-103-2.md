---
id: KN-362
type: knowledge
role: knowledge
title: "Assessment: Implementation — tiered review (SPEC-103) (2026-07-28)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-109
links:
  - {id: PLAN-109, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYKX7S3AHCX5ER8R9B7W8X16`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TIER-1 | 91 | Ledger fast-track visible in corpus-service diff (status ternary + details.auto='ledger-fast-track' on the single create audit row), gated on ledgerAutoApprove===true. 5 passing runs, 4 attested across three recorders. | 01KYKX7VHCGY717ME6JVYV5GBN (T1 service impl, self-reported pass), 01KYMBP3R3H41DTTXK9KCPXPWA (attested rerun with output_tail (6 tests pass)) |
| AC-TIER-2 | 74 | Tests pass (5/0, 4 attested), but the shown code is NOT atomic as the AC words it: reset and re-fast-track are two sequential updateWithProvenance calls; a failed second write returns err leaving the doc committed in draft, with no compensating rollback. | 01KYM9H4BFWMF066QRQ4YKB3Y2 (T3 finding (3) asked to verify atomicity; diff shows two-step CAS, not one transaction) |
| AC-TIER-3 | 84 | pending() post-filter + PendingFilters.all + CLI --all all visible and coherent. Evidence is a single vitest case (18 skipped) covering both the exclude and the --all-restore halves — thin for a two-clause AC, but passing and attested 4x. | 01KYKX7WPE57QGTFQNZXHCFMX7 (T2 gate+cli; output_tail shows 1 pass / 18 skipped) |
| AC-TIER-4 | 90 | Both clauses named as discrete passing integration tests in output_tail (exit-4 deny naming lore review; success after fresh approve-judgment). 5 pass / 0 fail, 4 attested. Gate wiring visible end-to-end (app.ts → ReviewService → checkpoint-registry). | 01KYMBP3R3H41DTTXK9KCPXPWA (attested, 2 pass / 6 filtered / 0 fail) |
| AC-TIER-5 | 76 | All three clauses appear as named passing tests, but one attested run FAILED ('version bump + fresh approve-judgment' timed out at 5000ms) and passed on rerun at 4305ms. Sibling cases run 3.1–4.8s against a 5s limit — a real flake margin, not a fixed defect. | 01KYM9H4BFWMF066QRQ4YKB3Y2 (attested fail (timeout) then attested pass in same task) |
| AC-TIER-6 | 85 | Collision partition (judgeIdentitiesEqual) + distinct COLLISION vs NO_JUDGMENT reasons + distinct feeding message all visible; 6 pass / 0 fail, 4 attested. Caveat T4 itself states: on this corpus (claude-cli) provenance is omitted, so I1 is exercised only synthetically. | 01KYKX7WPE57QGTFQNZXHCFMX7 (gate half), 01KYMBP3R3H41DTTXK9KCPXPWA (T4 states I1 is N/A for claude-cli docs by design) |
| AC-TIER-7 | 79 | Kill switches exist and are honored (ledgerAutoApprove===true guard; empty judgmentRequiredTypes short-circuit). 5 pass, 4 attested. But 'byte-identically' is asserted, not measured, and config.ts's own JSDoc concedes the test proves the explicit-override path, not the absent-config default path. | 01KYKX7VHCGY717ME6JVYV5GBN (T1 config keys + kill-switch tests) |
| AC-TIER-8 | 88 | backfillLedger + reserved positional verb visible; idempotence is structural (status:'draft' query can't re-match an approved doc). One test asserting both runs, 11 expect() calls, 5 pass / 0 fail, 4 attested. | 01KYKX7WPE57QGTFQNZXHCFMX7 (attested integration run) |
| AC-TIER-9 | 62 | AC names three behaviors; the evidence output_tail shows exactly two passing tests (approves never-judged with audit row; rejected loud when a judgment exists). The mutual-exclusivity clause (both flags → non-zero exit) has no visible test, and no mutex code appears in the shown approve.ts/review-s… | 01KYMBP3R3H41DTTXK9KCPXPWA (single evidence record, 2 pass / 6 filtered) |
| AC-TIER-10 | 80 | _resolveAiProvenance omits rather than fabricates; GENERATE_PROMPT_VERSION now registry-backed and SSOT-linked to the rendered template set. 2 pass (1 attested) + a separate http-provider test. HttpAIProvider.modelId itself is in the truncated set, so the 'real model id' half is unseen. | 01KYMBP3R3H41DTTXK9KCPXPWA (T4; http-provider.test.ts pass, self-reported by agent:provider-modelid) |

## Gaps

- The AC asserts three behaviors but the recorded run shows only two named passing tests (override-no-judgment approves a never-judged doc; rejected loud when a judgment exists). No test and no visible code covers '--override-judgment and --override-no-judgment together exit non-zero as mutually exclusive'; approve.ts merely spreads both options through to the service.
- corpus-service.set implements the ledger edit path as two sequential updateWithProvenance calls (reset to draft, then re-fast-track at version+1 CAS-guarded on the reset version). If the second write fails it returns err with the reset already committed, leaving an approved ledger doc stranded in draft. The AC and the D4 comment both say 'atomic'; the code is a compensating two-step with no compensation.
- One attested AC-TIER-5 record is a FAIL — 'version bump + fresh approve-judgment approves' timed out after 5000ms — and the subsequent attested pass for the same case took 4305ms. Neighbouring cases run 3.1–4.8s. The green result depends on staying under a limit the suite has already crossed once.
- T1 (01KYKX7VHCGY717ME6JVYV5GBN) contributes 5 evidence records, all recorded by the implementing agent (agent:tiered-review) with zero attestation and no output tails. AC-TIER-1/2/6/7 rest partly on unattested self-report, though later orchestrator reruns cover the same commands.
- The plan states 'ACs AC-TIER-1..8'. Execution added AC-TIER-9 and AC-TIER-10 to the spec via T3-hardening and T4, and touched files outside the declared anchors (config.ts, types.ts, ai/templates.ts, checkpoint-registry.ts, app.ts). Each addition is task-documented as remediation of assessment findings, so the drift is visible rather than silent.
- The ModelAwareProvider interface JSDoc was updated to name HttpAIProvider as its implementor, but _resolveAiProvenance's JSDoc directly below still reads 'true of every CURRENT provider — HttpAIProvider/InMemoryAIProvider have not been wired to expose one'. The comment that exists specifically to document provenance honesty is now false.

## Recommendations

- Add an integration case asserting that passing --override-judgment and --override-no-judgment together exits non-zero, or amend AC-TIER-9 to the two clauses the current suite proves.
- Resolve the AC-TIER-2 atomicity wording against the implementation: either wrap reset + re-fast-track in one transaction, or restate the AC and D4 as 'two audited CAS writes' and document the draft-stranding failure mode.
- Raise the bun test timeout on tiered-review-gate.bun.test.ts above the observed 4.8s worst case, and treat a rerun-to-green after an attested fail as requiring a recorded root-cause note.
- Require at least one attested (non-implementer) oracle record per task before archiving; T1 archived with 5/5 self-reported.
- Fix the stale _resolveAiProvenance JSDoc and decide whether 'review-judgment' should join ALL_GATE_CHECKPOINTS so armed-gates output reflects the new gate.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 104972ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/tiered-review.test.ts, diff:packages/lore/tests/integration/cli/tiered-review-gate.bun.test.ts, diff:packages/lore/tests/integration/gate-enforcer-service-layer.bun.test.ts, diff:packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts, diff:packages/lore/tests/integration/gate-spec-promote.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/review-service.test.ts, diff:packages/lore/tests/integration/cli/review.test.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli-feed-task-start.bun.test.ts, diff:packages/lore/tests/integration/gate-hooks.bun.test.ts, diff:packages/lore/tests/integration/p2-e2e-closed-loop.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-handoff.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/tests/integration/cli/tiered-review-gate.bun.test.ts, diff:packages/lore/tests/unit/service/tiered-review.test.ts, diff:packages/lore/src/ai/http-provider.ts, diff:packages/lore/tests/unit/ai/http-provider.test.ts
- Reasoning clipped for: AC-TIER-9

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.75 | evidence | M1/M2/M3 all land with passing oracles for 10 ACs. Deductions: AC-TIER-9's mutex clause unproven, AC-TIER-2's 'atomic' claim contradicted by the two-write code shown. |
| evidence_integrity | 74 | 0.8 | evidence | 34 records, output_tails present, three recorders. But T1 is fully self-reported, ratio is 0.67, and one attested AC-TIER-5 fail was resolved by rerun rather than a fix. |
| scope_fidelity | 80 | 0.7 | evidence | Files touched extend well past the plan's named anchors (config, types, templates, checkpoint-registry) and two ACs were added mid-flight — all documented as remediation, none silent. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TIER-9 | The AC asserts three behaviors but the recorded run shows only two named passing tests (override-no-judgment approves a never-judged doc; rejected loud when a judgment exists). No test and no visible code covers '--override-judgment and --override-no-judgment together exit non-zero as mutually exclusive'; approve.ts merely spreads both options through to the service. |
| outcome | major | AC-TIER-2 | corpus-service.set implements the ledger edit path as two sequential updateWithProvenance calls (reset to draft, then re-fast-track at version+1 CAS-guarded on the reset version). If the second write fails it returns err with the reset already committed, leaving an approved ledger doc stranded in draft. The AC and the D4 comment both say 'atomic'; the code is a compensating two-step with no compensation. |
| evidence_integrity | minor | AC-TIER-5 | One attested AC-TIER-5 record is a FAIL — 'version bump + fresh approve-judgment approves' timed out after 5000ms — and the subsequent attested pass for the same case took 4305ms. Neighbouring cases run 3.1–4.8s. The green result depends on staying under a limit the suite has already crossed once. |
| evidence_integrity | minor | — | T1 (01KYKX7VHCGY717ME6JVYV5GBN) contributes 5 evidence records, all recorded by the implementing agent (agent:tiered-review) with zero attestation and no output tails. AC-TIER-1/2/6/7 rest partly on unattested self-report, though later orchestrator reruns cover the same commands. |
| scope_fidelity | minor | — | The plan states 'ACs AC-TIER-1..8'. Execution added AC-TIER-9 and AC-TIER-10 to the spec via T3-hardening and T4, and touched files outside the declared anchors (config.ts, types.ts, ai/templates.ts, checkpoint-registry.ts, app.ts). Each addition is task-documented as remediation of assessment findings, so the drift is visible rather than silent. |
| outcome | minor | AC-TIER-10 | The ModelAwareProvider interface JSDoc was updated to name HttpAIProvider as its implementor, but _resolveAiProvenance's JSDoc directly below still reads 'true of every CURRENT provider — HttpAIProvider/InMemoryAIProvider have not been wired to expose one'. The comment that exists specifically to document provenance honesty is now false. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add an integration case asserting that passing --override-judgment and --override-no-judgment together exits non-zero, or amend AC-TIER-9 to the two clauses the current suite proves. | One third of a stated AC currently has no oracle behind it. |
| spec | Resolve the AC-TIER-2 atomicity wording against the implementation: either wrap reset + re-fast-track in one transaction, or restate the AC and D4 as 'two audited CAS writes' and document the draft-stranding failure mode. | The AC and the shipped code disagree on a durability property; the passing test does not exercise a mid-sequence write failure. |
| process | Raise the bun test timeout on tiered-review-gate.bun.test.ts above the observed 4.8s worst case, and treat a rerun-to-green after an attested fail as requiring a recorded root-cause note. | AC-TIER-5's green depends on a margin the suite has already exceeded once. |
| process | Require at least one attested (non-implementer) oracle record per task before archiving; T1 archived with 5/5 self-reported. | Attested ratio 0.67 is driven entirely by one task's unverified trail. |
| plan | Fix the stale _resolveAiProvenance JSDoc and decide whether 'review-judgment' should join ALL_GATE_CHECKPOINTS so armed-gates output reflects the new gate. | Both are self-flagged deferrals in the diff's own comments. |

## Unverifiable Materials

- packages/lore/src/ai/http-provider.ts (HttpAIProvider.modelId): Truncated from the diff; AC-TIER-10's 'real model id' half rests on it plus a self-reported http-provider.test.ts pass.
- packages/lore/src/service/review-service.ts overrideNoJudgment handling: The second review-service hunk is truncated, so the mutual-exclusivity check AC-TIER-9 requires could not be located in the shown code.
- tests/integration/cli/tiered-review-gate.bun.test.ts and tests/unit/service/tiered-review.test.ts: Truncated; test assertion strength judged only from names, pass counts, and expect() counts in output tails.
- SPEC-103 source text (M1/M2/M3, D1/D3/D4, I1): Only quoted via diff comments and the AC table; the atomicity and mutex requirements could not be read at the spec itself.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.67
