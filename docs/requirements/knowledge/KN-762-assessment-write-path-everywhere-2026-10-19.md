---
id: KN-762
type: knowledge
role: knowledge
title: "Assessment: Write path everywhere (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-229
links:
  - {id: PLAN-229, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M59FBEQDBFEA3332YAZVBHXD`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DCL-5 | 78 | Attested expected-fail then pass of write-path-everywhere test; typecheck passes. The diff routes the shown modules through writeDoc/insertDoc/appendAudit, and the ordinal repair is now one store transaction. The tails stop at the build step, so test counts and the scan are unseen. The red run is n… | 01M59FBFKH2A5J23S09MRP87NB (evidence [1] expected-fail, [2] pass, [10] tsc pass) |

## Gaps

- RuleChangeService passes foreignIntent=true whenever a write authority is armed, so it relies on every write path calling authorize() first. If one skips it, a foreign write is allowed silently.

## Recommendations

- Make evidence tails capture the test runner's final summary (pass/fail counts) rather than the build preamble.
- For mutation red runs, record the exact restored call (file and line) alongside the expected-fail evidence.
- State whether reserveProposedRule's audit row must be in the same transaction, as was required for assignOrdinalForRepair.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 31433ms
- Retried: false
- Truncated sections: diff:packages/lore/src/service/review-service.ts, diff:packages/lore/src/service/spec-kind-service.ts, diff:packages/lore/src/service/spec-parent-migration-service.ts, diff:packages/lore/src/service/state-binding-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/src/store/write-context-store.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/tests/integration/phase-write-audit-pairing.test.ts, diff:packages/lore/tests/unit/service/outline-migration-dryrun.bun.test.ts, diff:packages/lore/tests/unit/service/review-approve-toctou.test.ts, diff:packages/lore/tests/unit/service/review-service.test.ts, diff:packages/lore/src/adapters/cli/loader.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/foreign-corpus-write-guard.ts, diff:packages/lore/src/service/judgment-service.ts, diff:packages/lore/tests/integration/write-route-honours-corpus-scope.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/baseline-adopt.ts, diff:packages/lore/src/app.ts, diff:packages/lore/tests/integration/single-write-path.bun.test.ts, diff:packages/lore/tests/integration/write-path-everywhere.bun.test.ts, diff:packages/lore/tests/integration/single-write-path.bun.test.ts
- Reasoning clipped for: AC-DCL-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.6 | evidence | Visible modules are routed correctly and D3 is atomic via the WithProvenance store method. A few modules, the store impls and the scan test are unseen; minor atomicity and bypass seams remain. |
| evidence_integrity | 72 | 0.6 | evidence | All evidence is attested, with a red-then-green sequence and tsc. The tails are truncated before results, and the red run's cause is unproven. |
| scope_fidelity | 88 | 0.7 | evidence | Changes are confined to write-path routing, the new CorpusService routes, the store interface and wiring. Actor attribution changes (system→caller) are in line with the AC. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-DCL-5 | RuleChangeService passes foreignIntent=true whenever a write authority is armed, so it relies on every write path calling authorize() first. If one skips it, a foreign write is allowed silently. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make evidence tails capture the test runner's final summary (pass/fail counts) rather than the build preamble. | Truncated tails make an attested pass hard to audit. |
| plan | For mutation red runs, record the exact restored call (file and line) alongside the expected-fail evidence. | The AC requires a specific red; a generic expected-fail is ambiguous. |
| spec | State whether reserveProposedRule's audit row must be in the same transaction, as was required for assignOrdinalForRepair. | The atomicity requirement is uneven across the new routes. |

## Unverifiable Materials

- packages/lore/tests/integration/write-path-everywhere.bun.test.ts: Omitted. The scan logic, the per-module tests for all 17 modules and the injected-failure test cannot be inspected.
- packages/lore/src/store/sqlite-store.ts, turso-store.ts, in-memory-store.ts: Omitted. The atomicity of assignOrdinalForRepairWithProvenance is unseen.
- task-workflow-service.ts, review-service.ts, spec-kind-service.ts, spec-parent-migration-service.ts, state-binding-service.ts: Omitted. The migration of these modules cannot be checked.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 0
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 3
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

3 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] The AC-DCL-5 output tails end at the build step. No test summary, scan result or per-module assertions are visible, and the expected-fail run is not shown to come from restoring a direct call in a migrated module. — "packages/lore/tests/integration/write-path-everywhere.bun.test.ts" was never shown to the judge (omitted from the truncated diff)
- [minor] CorpusService.reserveProposedRule commits reserveProposedRuleAndUpdateSpec, then calls store.appendAuditEntry separately. An audit failure leaves a version bump with no audit row. — "packages/lore/src/service/corpus-service.ts" was never shown to the judge (omitted from the truncated diff)
- [minor] seedAcCiteModeAudited writes its audit row through bareDocWriter(store), not the composed CorpusService. Whether a linked worktree is refused on this path is unverified. — "packages/lore/src/adapters/cli/commands/baseline-adopt.ts" was never shown to the judge (omitted from the truncated diff)

## Facts Summary

- AC coverage: 1 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
