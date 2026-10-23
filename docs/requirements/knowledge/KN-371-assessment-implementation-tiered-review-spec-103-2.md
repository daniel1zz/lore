---
id: KN-371
type: knowledge
role: knowledge
title: "Assessment: Implementation — tiered review (SPEC-103) (2026-07-28)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-10-23
tags: []
parent: PLAN-109
links:
  - {id: PLAN-109, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KYKX7S3AHCX5ER8R9B7W8X16`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TIER-1 | 90 | Vitest run attested by agent:main-orchestrator (6 pass/9 skipped) plus implementer self-report. Diff shows shouldLedgerFastTrack gating status="approved" in the same insert and details.auto="ledger-fast-track" on the single create audit row, reading resolvedExtra (same object as doc.extra). | 01KYKX7VHCGY717ME6JVYV5GBN (T1 evidence [1]), 01KYKX7WPE57QGTFQNZXHCFMX7 (attested evidence [7] with output tail) |
| AC-TIER-2 | 78 | Attested pass (2 pass/13 skipped). Implementation is two sequential updateWithProvenance calls (reset then re-fast-track), not a single transaction, despite the AC and code comments both saying "atomically" — a failure between the writes leaves the doc draft at version N+1. | 01KYKX7WPE57QGTFQNZXHCFMX7 (attested evidence [8]) |
| AC-TIER-3 | 88 | Attested vitest pass. pending() post-filters via isLedgerOrTaskDoc unless filters.all; CLI --all wired in pending.ts. Filter composes independently with include_invalid. Pre-existing tests updated to {all:true}, consistent with the intended behavior change. | 01KYKX7WPE57QGTFQNZXHCFMX7 (evidence [1] and attested [9]) |
| AC-TIER-4 | 90 | Integration test attested with named test output: zero-judgment approve exits 4 naming lore review; fresh current-version approve-judgment approves. Gate is a pure checkpoint (checkReviewJudgment) fed by ReviewService IO, with feed text naming `lore review <doc>`. | 01KYKX7WPE57QGTFQNZXHCFMX7 (attested evidence [10], 2 pass/0 fail) |
| AC-TIER-5 | 80 | Attested integration output shows all three sub-cases passing; worstReviewDecision ranks reject>escalate>approve per version. But --override-judgment hard-requires an existing judgment id on the doc, so it cannot unblock the NO_JUDGMENT denial its own JSDoc claims to cover. | 01KYKX7WPE57QGTFQNZXHCFMX7 (attested evidence [11]; audit row records override_judgment_id) |
| AC-TIER-6 | 78 | Attested vitest pass (4 pass/11 skipped) and provenance-less doc path covered. Weakness: AIProviderService sets ai_provenance.model = this.active (the provider name) and prompt_version to a hardcoded "v1", so the I1 collision tuple is far coarser than provider/model/prompt_version implies. | 01KYKX7WPE57QGTFQNZXHCFMX7 (attested evidence [12]) |
| AC-TIER-7 | 82 | Attested vitest pass. Both kill switches exist and are honored (ledgerAutoApprove===true guard; empty judgment_required_types short-circuits). "Byte-identical" is asserted only for the explicit-override path — config JSDoc itself concedes the absent-config default path is untested. | 01KYKX7WPE57QGTFQNZXHCFMX7 (attested evidence [13]) |
| AC-TIER-8 | 88 | Attested integration test (1 pass, 11 expect calls) covering fast-track-once plus zero-change second run. Idempotence is structural (status:"draft" query), and per-doc failures are collected not fatal. CLI verb intercepted before mutex checks. | 01KYKX7WPE57QGTFQNZXHCFMX7 (attested evidence [14]) |

## Gaps

- The approved-ledger edit path performs updateWithProvenance twice (reset to draft, then re-approve) with an early return between them. This is not atomic: a failure or crash after the first write leaves an approved ledger doc in draft at a bumped version, with only the untagged 'update' audit row. The AC statement and multiple code comments assert atomicity that the implementation does not provide.
- AIProviderService.generate stamps ai_provenance as {provider: this.active, model: this.active, prompt_version: "v1"}. Model is the provider name and prompt_version is a hardcoded placeholder, so the I1 tuple collapses to roughly 'same provider'. This both over-blocks (any judgment from the same provider collides) and under-describes (no real model/prompt discrimination). AC-TIER-6 passes because the test fixtures control both sides of the tuple.
- approve() rejects --override-judgment unless the id resolves to an existing review_judgments row on the doc, yet ApproveOpts' JSDoc says the flag covers 'or simply "no independent judgment"'. In the NO_JUDGMENT case there is no id to supply, so the documented escape hatch is unreachable for the most common denial.
- Eight pre-existing test files were amended to neutralize the new default-on gate (judgment_required_types: []) or to pass {all:true}/--all. Each edit is annotated and plausible, but the breadth means the blast radius of the default-on M2 gate on existing user workflows is only visible through test churn, not through any migration note in the plan.
- Task T1 has zero attested evidence records of its own (5 self-reported by agent:tiered-review); independent confirmation exists only via the orchestrator's later re-runs recorded on T2. Overall attested_evidence_ratio is 0.42.

## Recommendations

- Add a follow-up task to make CorpusService.set's ledger reset + re-fast-track a single store transaction, or amend AC-TIER-2's wording to 'two audited writes within one set() call' so the oracle matches the guarantee actually shipped.
- Specify how ai_provenance.model and prompt_version are sourced before I1 is relied on. Require a per-provider model accessor and a BUILT_IN_TEMPLATES version registry; until then, document that I1 collision is provider-granularity only.
- Define --override-judgment behavior for the zero-judgment denial (e.g. accept a sentinel value or make the id optional while still writing an audit row), and add an AC-TIER-5 sub-case for it.
- Require at least one independently-attested oracle run per task before archiving, not only on the final task of a chain.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 85239ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/tiered-review.test.ts, diff:packages/lore/tests/integration/cli/tiered-review-gate.bun.test.ts, diff:packages/lore/tests/integration/cli/review.test.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/integration/gate-hooks.bun.test.ts, diff:packages/lore/tests/integration/p2-e2e-closed-loop.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-handoff.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | All 8 ACs pass with attested re-runs and the diff shows coherent M1/M2/M3 implementations; deductions for non-transactional re-fast-track, placeholder provenance tuple, and unusable override path. |
| evidence_integrity | 85 | 0.7 | evidence | Every AC has one independently-attested run with real output tails; attested ratio 0.42 and T1's own records are self-reported only. Test bodies were not shown, so assertion strength is unconfirmed. |
| scope_fidelity | 80 | 0.7 | evidence | Work matches P1/P2 milestones, but touches core ai.ts/config.ts/types.ts, checkpoint-registry, app.ts and rewrites a test config helper — beyond the plan's stated anchors, though each change is expla… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TIER-2 | The approved-ledger edit path performs updateWithProvenance twice (reset to draft, then re-approve) with an early return between them. This is not atomic: a failure or crash after the first write leaves an approved ledger doc in draft at a bumped version, with only the untagged 'update' audit row. The AC statement and multiple code comments assert atomicity that the implementation does not provide. |
| outcome | major | AC-TIER-6 | AIProviderService.generate stamps ai_provenance as {provider: this.active, model: this.active, prompt_version: "v1"}. Model is the provider name and prompt_version is a hardcoded placeholder, so the I1 tuple collapses to roughly 'same provider'. This both over-blocks (any judgment from the same provider collides) and under-describes (no real model/prompt discrimination). AC-TIER-6 passes because the test fixtures control both sides of the tuple. |
| outcome | minor | AC-TIER-5 | approve() rejects --override-judgment unless the id resolves to an existing review_judgments row on the doc, yet ApproveOpts' JSDoc says the flag covers 'or simply "no independent judgment"'. In the NO_JUDGMENT case there is no id to supply, so the documented escape hatch is unreachable for the most common denial. |
| scope_fidelity | minor | — | Eight pre-existing test files were amended to neutralize the new default-on gate (judgment_required_types: []) or to pass {all:true}/--all. Each edit is annotated and plausible, but the breadth means the blast radius of the default-on M2 gate on existing user workflows is only visible through test churn, not through any migration note in the plan. |
| evidence_integrity | minor | — | Task T1 has zero attested evidence records of its own (5 self-reported by agent:tiered-review); independent confirmation exists only via the orchestrator's later re-runs recorded on T2. Overall attested_evidence_ratio is 0.42. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a follow-up task to make CorpusService.set's ledger reset + re-fast-track a single store transaction, or amend AC-TIER-2's wording to 'two audited writes within one set() call' so the oracle matches the guarantee actually shipped. | The AC and code both claim atomicity that two sequential updateWithProvenance calls do not deliver. |
| spec | Specify how ai_provenance.model and prompt_version are sourced before I1 is relied on. Require a per-provider model accessor and a BUILT_IN_TEMPLATES version registry; until then, document that I1 collision is provider-granularity only. | Placeholder values make the self-review collision check both coarser and less meaningful than the spec's tuple implies. |
| spec | Define --override-judgment behavior for the zero-judgment denial (e.g. accept a sentinel value or make the id optional while still writing an audit row), and add an AC-TIER-5 sub-case for it. | The current validation makes the audited escape hatch unusable for the NO_JUDGMENT gate outcome it claims to cover. |
| process | Require at least one independently-attested oracle run per task before archiving, not only on the final task of a chain. | T1 archived with 5/5 self-reported records; attestation arrived only incidentally via T2's orchestrator re-runs. |

## Unverifiable Materials

- packages/lore/tests/unit/service/tiered-review.test.ts and tests/integration/cli/tiered-review-gate.bun.test.ts bodies: Omitted from the diff per the truncation manifest; assertion strength and whether the tests would fail against a stub implementation cannot be inspected.
- Plan execution note 'MUST NOT start until plan-implementation-trace-layer-spec-102 merges to main': No branch/merge metadata in the materials; sequencing compliance cannot be checked.
- Red-first claim ('Tests red-first') on both tasks: No failing-then-passing run pair is recorded in the evidence trail; only final passing runs are present.
- Full-suite regression result (bun run test / test:changed): Only per-AC filtered runs and one typecheck are recorded; broader regression impact of the default-on gate and pending filter is unmeasured.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.42
