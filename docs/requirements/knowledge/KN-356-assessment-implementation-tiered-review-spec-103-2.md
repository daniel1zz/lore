---
id: KN-356
type: knowledge
role: knowledge
title: "Assessment: Implementation — tiered review (SPEC-103) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-109
links:
  - {id: PLAN-109, type: informs}
---
# Assessment: partially_met (79/100)

Scope: plan `01KYKX7S3AHCX5ER8R9B7W8X16`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TIER-1 | 90 | Fast-track at create is visible in the diff (status ternary + details.auto='ledger-fast-track' on the single create audit row, ledger set SSOT via isLedgerKnowledgeSubType). Six passing runs, five attested by an independent recorder. | 01KYKX7VHCGY717ME6JVYV5GBN (T1 impl + vitest -t AC-TIER-1, attested), 01KYMBP3R3H41DTTXK9KCPXPWA (re-attested after T4) |
| AC-TIER-2 | 70 | Tests pass, but the shown corpus-service hunk implements 'atomic' as TWO sequential updateWithProvenance calls (CAS on expected_version), not one transaction; a failed second write leaves the doc draft. D4 atomicity is asserted in comments, not demonstrated by any oracle. | 01KYKX7VHCGY717ME6JVYV5GBN (vitest -t AC-TIER-2 pass), 01KYM9H4BFWMF066QRQ4YKB3Y2 (T3 'verify first' item on atomicity) |
| AC-TIER-3 | 82 | Post-filter isLedgerOrTaskDoc + filters.all wired through pending.ts --all; six passing runs. Oracle is a single unit test carrying both halves; CLI-level behavior of --all is not separately integration-evidenced. | 01KYKX7WPE57QGTFQNZXHCFMX7 (T2 vitest -t AC-TIER-3, 1 test) |
| AC-TIER-4 | 90 | Two integration tests (exit 4 naming lore review; success after fresh judgment) pass repeatedly with attestation; gate wiring visible end-to-end (checkpoint-registry review-judgment + enforceJudgmentRequiredGate + app.ts DI). | 01KYKX7WPE57QGTFQNZXHCFMX7 (bun test -t AC-TIER-4), 01KYM9H4BFWMF066QRQ4YKB3Y2 (re-attested in worktree) |
| AC-TIER-5 | 80 | All three sub-cases pass (worst-decision-wins, version bump, --override-judgment audited). One attested FAIL exists (5s timeout on 'version bump' during T3) later superseded by attested passes — timing flakiness, not a logic failure, but it dents confidence in the suite's stability. | 01KYM9H4BFWMF066QRQ4YKB3Y2 (evidence [8] fail (timeout), [16] pass), 01KYMBP3R3H41DTTXK9KCPXPWA (attested pass post-T4) |
| AC-TIER-6 | 76 | Collision predicate + dedicated feeding message are in the diff and 7 runs pass. But T4's own text concedes the active provider (claude-cli) never emits modelId, so ai_provenance is omitted in production and I1 collision detection is exercised only via test doubles. | 01KYKX7WPE57QGTFQNZXHCFMX7 (gate half), 01KYMBP3R3H41DTTXK9KCPXPWA (T4 states I1 is N/A on this corpus) |
| AC-TIER-7 | 80 | Kill switches exist and resolve safely (fully optional-chained resolvers). Six passing runs. 'Byte-identical' is proven only for the EXPLICIT override path — config.ts's own JSDoc states the absence/default path is not what AC-TIER-7 covers; no differential/baseline oracle. | 01KYKX7VHCGY717ME6JVYV5GBN (vitest -t AC-TIER-7, 2 tests) |
| AC-TIER-8 | 88 | backfillLedger + reserved positional verb are in the diff; idempotence is structural (status='draft' query) and a single integration test with 11 assertions covers run-once + zero-change second run, attested across three recorders. | 01KYKX7WPE57QGTFQNZXHCFMX7 (bun test -t AC-TIER-8) |
| AC-TIER-9 | 66 | Only 2 tests match -t override-no-judgment: the approve+audit case and the loud-rejection case. The AC's THIRD clause — both override flags together exiting non-zero as mutually exclusive — has no matching test, and the shown approve.ts adds no mutex (both spreads can fire). | 01KYM9H4BFWMF066QRQ4YKB3Y2 (2 pass, 6 filtered out) |
| AC-TIER-10 | 78 | GENERATE_PROMPT_VERSION registry + _resolveAiProvenance's no-fabrication omission are visible and honest. Only 2 tests match the -t ai_provenance filter for a 3-clause AC, and HttpAIProvider.modelId (the sole implementor) is an unseen file. | 01KYMBP3R3H41DTTXK9KCPXPWA (T4 modelId + http-provider.test.ts) |

## Gaps

- corpus-service.set() performs the ledger reset and the re-fast-track as two separate updateWithProvenance calls (second CAS-guarded on resetVersion), yet the AC and D4 call the sequence atomic. If the second write errors, set() returns err with the doc left demoted to draft — an approved ledger doc silently loses its status. No oracle covers the failure interleaving.
- The AC states three behaviors but only two tests match its oracle filter (2 pass, 6 filtered out). The mutual-exclusivity behavior is unevidenced, and the shown approve.ts applies both option spreads unconditionally, so nothing in reviewed code enforces the exclusion.
- T4's own task text concedes that on this corpus the active provider is claude-cli, which exposes no modelId, so _resolveAiProvenance always returns undefined and ai_provenance is omitted. I1 self-review collision detection therefore never triggers in the deployed configuration; its AC passes purely on synthetic fixtures.
- The re-fast-track branch returns early from set(), bypassing the shouldAllocateOrdinalOnKindFlip block below it. Ledger docs are knowledge-typed so this is likely inert today, but it is an untested control-flow bypass rather than a proven-unreachable one.
- The attested fail on AC-TIER-5 was a 5000ms timeout with individual cases already at 3.2–4.5s. The later passes are real, but the margin means this oracle is one slow CI machine away from red; no timeout adjustment appears in the diff.
- Plan declared AC-TIER-1..8 and tasks T1→T2 in one worktree; execution added T3 (hardening) and T4 (provider modelId) plus two new spec ACs. The growth is documented and remediation-driven, but the plan was not visibly amended to reflect the enlarged surface.

## Recommendations

- Either wrap corpus-service's reset + re-fast-track in one store transaction, or amend SPEC-103 D4 and AC-TIER-2 to say 'two audited writes, the second CAS-guarded on the reset version' and add a test asserting the observable state when the second write fails.
- Add the missing AC-TIER-9 sub-case test for the two override flags used together, and enforce the mutex explicitly (CLI arg check or ReviewService VALIDATION_ERROR) rather than relying on option-spread ordering.
- For ACs whose statements enumerate N behaviors, require the oracle's pass count to be >= N or a note explaining the grouping; AC-TIER-9 (3 clauses/2 tests) and AC-TIER-10 (3 clauses/2 tests) both slipped through.
- State plainly in SPEC-103 that I1 collision detection is dormant until a ModelAwareProvider-implementing provider is the active one, so future readers do not treat AC-TIER-6's green as production coverage.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 106591ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/tiered-review.test.ts, diff:packages/lore/tests/integration/cli/tiered-review-gate.bun.test.ts, diff:packages/lore/tests/integration/gate-enforcer-service-layer.bun.test.ts, diff:packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts, diff:packages/lore/tests/integration/gate-spec-promote.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/review-service.test.ts, diff:packages/lore/tests/integration/cli/review.test.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli-feed-task-start.bun.test.ts, diff:packages/lore/tests/integration/gate-hooks.bun.test.ts, diff:packages/lore/tests/integration/p2-e2e-closed-loop.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-handoff.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/tests/integration/cli/tiered-review-gate.bun.test.ts, diff:packages/lore/tests/unit/service/tiered-review.test.ts, diff:packages/lore/src/ai/http-provider.ts, diff:packages/lore/tests/unit/ai/http-provider.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.72 | evidence | All 10 ACs have passing oracles and the diff shows coherent M1/M2/M3 mechanisms; deductions for the non-transactional 'atomic' path, unevidenced flag mutex, and production-inert I1. |
| evidence_integrity | 84 | 0.75 | evidence | Every AC carries independently attested runs (ratio 0.72) with output tails; one attested fail is disclosed rather than hidden and later superseded. Test files themselves are unseen. |
| scope_fidelity | 76 | 0.65 | evidence | T3/T4 and ACs 9/10 go beyond the plan's T1→T2, AC-1..8 declaration, but each is documented remediation of an assessment finding; sequencing precondition vs SPEC-102 unverifiable. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TIER-2 | corpus-service.set() performs the ledger reset and the re-fast-track as two separate updateWithProvenance calls (second CAS-guarded on resetVersion), yet the AC and D4 call the sequence atomic. If the second write errors, set() returns err with the doc left demoted to draft — an approved ledger doc silently loses its status. No oracle covers the failure interleaving. |
| outcome | major | AC-TIER-9 | The AC states three behaviors but only two tests match its oracle filter (2 pass, 6 filtered out). The mutual-exclusivity behavior is unevidenced, and the shown approve.ts applies both option spreads unconditionally, so nothing in reviewed code enforces the exclusion. |
| outcome | minor | AC-TIER-6 | T4's own task text concedes that on this corpus the active provider is claude-cli, which exposes no modelId, so _resolveAiProvenance always returns undefined and ai_provenance is omitted. I1 self-review collision detection therefore never triggers in the deployed configuration; its AC passes purely on synthetic fixtures. |
| outcome | minor | AC-TIER-2 | The re-fast-track branch returns early from set(), bypassing the shouldAllocateOrdinalOnKindFlip block below it. Ledger docs are knowledge-typed so this is likely inert today, but it is an untested control-flow bypass rather than a proven-unreachable one. |
| evidence_integrity | minor | AC-TIER-5 | The attested fail on AC-TIER-5 was a 5000ms timeout with individual cases already at 3.2–4.5s. The later passes are real, but the margin means this oracle is one slow CI machine away from red; no timeout adjustment appears in the diff. |
| scope_fidelity | minor | — | Plan declared AC-TIER-1..8 and tasks T1→T2 in one worktree; execution added T3 (hardening) and T4 (provider modelId) plus two new spec ACs. The growth is documented and remediation-driven, but the plan was not visibly amended to reflect the enlarged surface. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Either wrap corpus-service's reset + re-fast-track in one store transaction, or amend SPEC-103 D4 and AC-TIER-2 to say 'two audited writes, the second CAS-guarded on the reset version' and add a test asserting the observable state when the second write fails. | The word 'atomic' currently overstates what the code and the oracle demonstrate. |
| spec | Add the missing AC-TIER-9 sub-case test for the two override flags used together, and enforce the mutex explicitly (CLI arg check or ReviewService VALIDATION_ERROR) rather than relying on option-spread ordering. | One third of a declared AC is unevidenced and no reviewed code enforces it. |
| process | For ACs whose statements enumerate N behaviors, require the oracle's pass count to be >= N or a note explaining the grouping; AC-TIER-9 (3 clauses/2 tests) and AC-TIER-10 (3 clauses/2 tests) both slipped through. | Filter-based -t oracles silently under-cover multi-clause ACs. |
| spec | State plainly in SPEC-103 that I1 collision detection is dormant until a ModelAwareProvider-implementing provider is the active one, so future readers do not treat AC-TIER-6's green as production coverage. | The limitation is currently only in task prose, not the spec. |

## Unverifiable Materials

- packages/lore/tests/unit/service/tiered-review.test.ts and tests/integration/cli/tiered-review-gate.bun.test.ts: Omitted from the diff; assertion strength, fixture realism, and whether 13-18 skipped tests hide gaps cannot be judged from run summaries alone.
- review-service.ts overrideNoJudgment handling and any flag mutex: The AC-TIER-9 service-side logic lives in an omitted region; only the CLI flag plumbing is visible, so mutual exclusivity could not be confirmed in code.
- packages/lore/src/ai/http-provider.ts (modelId implementor): Listed as changed but omitted; the sole ModelAwareProvider implementation backing AC-TIER-10 was not reviewable.
- Plan precondition 'MUST NOT start until plan-implementation-trace-layer-spec-102 merges to main': No merge/commit evidence in the materials; sequencing compliance could not be checked.
- Extra-schema acceptance of extra.ai_provenance on non-knowledge types: create.ts folds ai_provenance into extra for every doc type; whether strict per-type extra schemas accept the key is not shown.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 4 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.72
