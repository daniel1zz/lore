---
id: KN-704
type: knowledge
role: knowledge
title: "Assessment: Corpus truthfulness: finish AC-CT-3..10 (never implemented) (2026-10-18)"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-202
links:
  - {id: PLAN-202, type: informs}
---
# Assessment: partially_met (72/100)

Scope: plan `01M54HC60DV5F58PAWDHG5TX1P`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CT-1 | 35 | No evidence for AC-CT-1 in this bundle (0 pass/0 fail). The plan overview says it was attested earlier, outside this plan, but nothing here shows it, so it is scored conservatively. Mitigation: it is outside this plan's exit criteria. | — |
| AC-CT-2 | 35 | No evidence for AC-CT-2 in this bundle. The overview claims a prior attested pass elsewhere, but it cannot be checked here. Mitigation: it is not part of this plan's exit criteria. | — |
| AC-CT-3 | 82 | Red-first expected-fail, then attested passes (23 tests) at the named path, run in a worktree and on the main checkout. CT-3b adds capture stamping and init arming with red-first evidence. None of falsifiers (a)-(e) are shown being run. | task-skill-implement-ct-3-ac-ct-3-stamp-axis-per-corpus-arming, task-skill-implement-ct-3b-lore-evidence-capture-stamps-like, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-4 | 82 | Red-first TypeError (blastRadiusChanged missing), then 11 passing tests including halves (c) and the shared-port test. The gate re-ran it on main. No evidence that the 15% unmeasured-share re-measurement the spec assigns to CT-9 was recorded. | task-skill-implement-ct-4-ac-ct-4-blast-radius-staleness-via, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-5 | 84 | The red test names the state_moved real-commit case; 6 tests pass with the echo; the gate re-ran it on main. The tail confirms the pass but cannot show that the seam uses a real commit rather than a fake port. The falsifier run is not shown. | task-skill-implement-ct-2-ac-ct-5-runner-reads-the-stamp-before, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-6 | 75 | Retired by correction; the tombstone grep passes (1/1). Whether the retirement reason and the Scope-table removal reached the spec rests only on a scratchpad check script (CT-1), which cannot be audited here. | task-skill-test-ct-9-plan-gate-on-merged-main, task-skill-spec-ct-1-spec-corrections-c1-c9-with-the-user-s |
| AC-CT-7 | 85 | Attested pass of check-ac-state-renderers: 0 violations, 4 rule-1 waivers. CT-6b moved readStampVerdict into core, which removes a second derivation. | task-skill-test-ct-9-plan-gate-on-merged-main, task-skill-refactor-ct-6b-one-stamp-verdict-derivation-in-core |
| AC-CT-8 | 82 | Red-first, then 9 passing tests, including real lore verify/status in a throwaway corpus (held -> SKIPPED, released -> stamped). The gate re-ran it on main. | task-skill-implement-ct-7-ac-ct-8-occupancy-skipped-and, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-9 | 82 | Red-first, then 35 passing tests, including a compile-fail never-check with a green control. The diff shows the floor reads stamp then radius, and the stale exclusion is in evidence-panel. The assess/status distribution line comes from one shared predicate. | task-skill-implement-ct-5-ac-ct-9-floor-reads-stamp-then-radius, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-10 | 88 | Red-first (22/22 fail with the script absent), then a pass. CT-6b's red (raw switch re-added -> exit 1) proves the scan is not inert, and the allowlist went from 2 rows to 1. The gate shows 0 violations. | task-skill-implement-ct-6-ac-ct-10-capture-source-bucket-site, task-skill-refactor-ct-6b-one-stamp-verdict-derivation-in-core, task-skill-test-ct-9-plan-gate-on-merged-main |

## Gaps

- The CT-9 plan gate records no `bun run test` or `bun run typecheck` on merged main, and the check:ac-oracle-ownership pass shows no output proving the ledger holds zero AC-CT rows.
- The spec makes the CT-9 gate own re-measuring the share of script-mode ACs with no pathspec against the 15% trigger. No recorded measurement appears.
- CT-1 and R1 evidence point to scratchpad scripts outside the repo (/private/tmp/...). Their content cannot be verified.
- The mandatory falsifiers for AC-CT-3/4/5 (e.g. stampCurrency returns stamped for an undefined stamp; merge-base swap) have no recorded runs.

## Recommendations

- Re-run the CT-9 gate with captured bun run test, bun run typecheck and ownership-check output, and record the unmeasured-pathspec share on the plan.
- Land unrelated test-infrastructure refactors (currentHomeDir, in-process runner) under their own plan.
- Store spec-correction check scripts in the repo, or attach their output tails.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 46551ms
- Retried: false
- Truncated sections: spec, diff:packages/lore/tests/unit/scripts/check-capture-source-buckets.test.ts, diff:packages/lore/tests/unit/service/stamp-types-compile-fail.fixture.ts, diff:packages/lore/tests/unit/service/stamp-types.test.ts, diff:scripts/check-capture-source-buckets.ts, diff:package.json, diff:packages/core/tests/home-dir-node.test.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/git-state-stamp.ts, diff:packages/lore/src/service/stamp-binding-reader.ts, diff:packages/lore/src/service/state-binding-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/verification-projection-service.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts, diff:packages/lore/tests/e2e/ac-command-pipe-compiled.bun.test.ts, diff:packages/lore/tests/e2e/ac-falsifier-range-compiled.bun.test.ts, diff:packages/lore/tests/e2e/ac-set-correction-compiled.bun.test.ts, diff:packages/lore/tests/e2e/baseline-rollback.bun.test.ts, diff:packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/context-verbs-compiled.bun.test.ts, diff:packages/lore/tests/e2e/done-worktree-cleanup-compiled.bun.test.ts, diff:packages/lore/tests/e2e/evidence-cd-chain-precheck-compiled.bun.test.ts, diff:packages/lore/tests/e2e/evidence-completeness-guard-compiled.bun.test.ts, diff:packages/lore/tests/e2e/evidence-dropped-file-guard-compiled.bun.test.ts, diff:packages/lore/tests/e2e/foreign-corpus-write-default.bun.test.ts, diff:packages/lore/tests/e2e/foreign-corpus-write-guard.bun.test.ts, diff:packages/lore/tests/e2e/issue-check.bun.test.ts, diff:packages/lore/tests/e2e/issue-close-on-archive-compiled.bun.test.ts, diff:packages/lore/tests/e2e/issue-closed-state.bun.test.ts, diff:packages/lore/tests/e2e/issue-closure-e2e.bun.test.ts, diff:packages/lore/tests/e2e/issue-closure.bun.test.ts, diff:packages/lore/tests/e2e/issue-task-done-close-compiled.bun.test.ts, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts, diff:packages/lore/tests/e2e/plan-close-known-false-pass.bun.test.ts, diff:packages/lore/tests/e2e/plan-exempt-attestation-compiled.bun.test.ts, diff:packages/lore/tests/e2e/rs-context-selection-cli.bun.test.ts, diff:packages/lore/tests/e2e/rs-fragments-check-duplicates.bun.test.ts, diff:packages/lore/tests/e2e/rs-skill-delivery-cli.bun.test.ts, diff:packages/lore/tests/e2e/rs-status-check-fragments.bun.test.ts, diff:packages/lore/tests/e2e/rs-user-config-resolver.bun.test.ts, diff:packages/lore/tests/e2e/rule-change-set-compiled.bun.test.ts, diff:packages/lore/tests/e2e/run-occupancy-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-check-sweep-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-corpus-resolution.bun.test.ts, diff:packages/lore/tests/helpers/clean-tree-repo.ts, diff:packages/lore/tests/helpers/cli-live-rule.ts, diff:packages/lore/tests/helpers/run-lore-in-process.ts, diff:packages/lore/tests/integration/anchor-coverage-surface.test.ts, diff:packages/lore/tests/integration/archive-apply-done-floors.bun.test.ts, diff:packages/lore/tests/integration/archive-sweep-cli.bun.test.ts, diff:packages/lore/tests/integration/audit-anchor.bun.test.ts, diff:packages/lore/tests/integration/cli-feed-task-start.bun.test.ts, diff:packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/in-process-parity.test.ts, diff:packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts, diff:packages/lore/tests/unit/scripts/check-capture-source-buckets.test.ts, diff:packages/lore/tests/unit/service/stamp-currency-floor.test.ts, diff:packages/lore/tests/unit/service/unmeasured-floor-consequence.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:scripts/changed-tests.ts, diff:scripts/check-capture-source-buckets.ts, diff:scripts/run-tests.ts, diff:scripts/selector-miss-report.ts, diff:scripts/test-budget-ledger.json, diff:scripts/test-global-setup.ts, diff:scripts/tests/selector-miss-report.test.ts, diff:scripts/tests/test-tree-snapshot-guard.test.ts, diff:scripts/tree-snapshot-guard.ts, diff:package.json, diff:packages/lore/tests/unit/scripts/check-capture-source-buckets.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:scripts/check-capture-source-buckets.ts, diff:packages/core/src/evidence-panel.ts, diff:packages/core/src/index.ts, diff:packages/core/src/stamp-binding.ts, diff:packages/core/src/task-workflow.ts, diff:packages/lore/src/adapters/cli/commands/audit.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/predicate-contracts.ts, diff:packages/lore/src/service/stamp-binding-reader.ts, diff:packages/lore/src/service/state-binding-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/verification-projection-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/stamp-currency-floor.test.ts, diff:packages/lore/tests/unit/service/stamp-types-compile-fail.fixture.ts, diff:packages/lore/tests/unit/service/stamp-types.test.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/adapters/oracle-occupancy.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/state-binding-skip.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/unit/service/occupancy-skip-continuity.test.ts, diff:scripts/oracle-lock.ts, diff:packages/core/src/task-workflow.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/unit/service/stamp-pre-post-demotion.test.ts, diff:packages/lore/tests/unit/service/stamp-types.test.ts, diff:packages/core/src/acceptance.test.ts, diff:packages/core/src/oracle-file-existence.ts, diff:packages/core/tests/unit/bootstrap-injection-contract.test.ts, diff:packages/core/tests/unit/vitest-bun-segment-recognition.test.ts, diff:packages/lore/src/adapters/real-git-port.ts, diff:packages/lore/src/service/ai-provider-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/git-diff-since.ts, diff:packages/lore/src/service/rule-state-git-port.ts, diff:packages/lore/tests/unit/adapters/blast-radius-staleness.test.ts, diff:packages/lore/tests/unit/service/ai-provider-service-comment-currency.test.ts, diff:scripts/check-ac-oracle-ownership.ts, diff:scripts/check-corpus-fail-census.ts, diff:scripts/tests/check-corpus-fail-census.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.6 | evidence | Every exit-criterion AC (3,4,5,8,9,10) has an attested pass on main and AC-CT-6 is retired; the gate's full test/typecheck runs and the 15% re-measure are missing. |
| evidence_integrity | 70 | 0.6 | evidence | Red-first then attested passes for every implementation task. CT-1/R1 rest on scratchpad scripts, falsifier runs are absent, and some rows are self-reported. |
| scope_fidelity | 55 | 0.6 | evidence | The diff carries substantial unexplained work: in-process runner, currentHomeDir across many files, stdio interceptor, run-cli extraction. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The CT-9 plan gate records no `bun run test` or `bun run typecheck` on merged main, and the check:ac-oracle-ownership pass shows no output proving the ledger holds zero AC-CT rows. |
| outcome | minor | AC-CT-4 | The spec makes the CT-9 gate own re-measuring the share of script-mode ACs with no pathspec against the 15% trigger. No recorded measurement appears. |
| evidence_integrity | minor | — | CT-1 and R1 evidence point to scratchpad scripts outside the repo (/private/tmp/...). Their content cannot be verified. |
| evidence_integrity | minor | — | The mandatory falsifiers for AC-CT-3/4/5 (e.g. stampCurrency returns stamped for an undefined stamp; merge-base swap) have no recorded runs. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Re-run the CT-9 gate with captured bun run test, bun run typecheck and ownership-check output, and record the unmeasured-pathspec share on the plan. | These are exit criteria and an owned spec duty. |
| process | Land unrelated test-infrastructure refactors (currentHomeDir, in-process runner) under their own plan. | Keeps this plan's scope auditable. |
| process | Store spec-correction check scripts in the repo, or attach their output tails. | Scratchpad paths cannot be audited. |

## Unverifiable Materials

- AC-CT-1/AC-CT-2 prior attested evidence: Named in the plan overview but absent from this bundle.
- CT-1 check-ct1.sh and R1 check-ct-r1.sh contents: Scratchpad scripts outside the repo, so their content cannot be read.
- check:ac-oracle-ownership output from CT-9: No output tail is shown that would confirm zero AC-CT ledger rows.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 3
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] Changes unrelated to the plan are in the diff: packages/core/src/home-dir-node.ts, packages/lore/src/adapters/cli/run-cli.ts, packages/lore/src/adapters/cli/stdio-sync.ts interceptor, packages/lore/src/adapters/cli/invocation-identity.ts reset, scripts/test-isolation-ledger.json. These serve adr-tg-1 in-process testing, not AC-CT-3..10. — "packages/core/src/home-dir-node.ts" not found at commit 7786f8e99f4bf12dca373fb149a282b6ebd7e10a

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 11 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.85
