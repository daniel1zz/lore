---
id: KN-705
type: knowledge
role: knowledge
title: "Assessment: Corpus truthfulness: finish AC-CT-3..10 (never implemented) (2026-10-18)"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
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
| AC-CT-1 | 45 | This plan records no AC-CT-1 evidence, and the AC Coverage facts show 0 pass. The plan overview says AC-CT-1 already carries attested passes from earlier work, and the exit criteria exclude it. That earlier evidence is not in these materials, so the score is conservative. | — |
| AC-CT-2 | 45 | This plan records no AC-CT-2 evidence (0 pass). The overview says AC-CT-2 was attested earlier, but that cannot be checked here. CT-3b's run of evidence-capture-attestation.test.ts carries no ac_ref. | task-skill-implement-ct-3b-lore-evidence-capture-stamps-like (evidence-capture-attestation.test.ts pass, ac_ref none) |
| AC-CT-3 | 82 | Two attested passes, including CT-9 on the main checkout (23 tests), with red-first recorded in CT-3. CT-3b adds init arming and capture stamping. No evidence shows falsifiers (a)-(e) were run, so they are unverified. | task-skill-test-ct-9-plan-gate-on-merged-main, task-skill-implement-ct-3-ac-ct-3-stamp-axis-per-corpus-arming, task-skill-implement-ct-3b-lore-evidence-capture-stamps-like |
| AC-CT-4 | 84 | Three attested passes (11 tests). The red-first failure shows blastRadiusChanged was absent before. One test asserts that SpawnGitPort.changedSince and gitDiffChangedSince are one diff implementation. No evidence shows the ancestry-swap falsifier was run. | task-skill-implement-ct-4-ac-ct-4-blast-radius-staleness-via, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-5 | 85 | Red-first fails on the state_moved case with a real commit, and the later runs pass (3 attested). The test names match the seam the AC pins. No evidence shows the post-run-only falsifier was run. | task-skill-implement-ct-2-ac-ct-5-runner-reads-the-stamp-before, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-6 | 40 | Retirement by correction is the plan's intended outcome. The only evidence is a CT-1 check script in a /private/tmp scratchpad, with no output shown. The tombstone grep command was never recorded as evidence (0 pass). | task-skill-spec-ct-1-spec-corrections-c1-c9-with-the-user-s (scratchpad check script only) |
| AC-CT-7 | 85 | One attested pass in CT-9: 0 violations over 523 files, with 4 rule-1 waivers. CT-6b moved readStampVerdict into core, which strengthens the one-derivation rule. | task-skill-test-ct-9-plan-gate-on-merged-main, task-skill-refactor-ct-6b-one-stamp-verdict-derivation-in-core |
| AC-CT-8 | 84 | Red-first then green (9 tests), including real `lore verify` and `lore status` runs in a throwaway corpus, with 2 attested passes. The reader and lock files (oracle-occupancy.ts, oracle-lock.ts) are not shown in the diff. | task-skill-implement-ct-7-ac-ct-8-occupancy-skipped-and, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-9 | 84 | Red-first then green with 2 attested passes. The diff shows stamp-before-radius precedence in readStampVerdict and stale rows excluded in evidence-panel. formatStampVerdictLine is shared by assess and status. The compile-fail fixture has a green control. | task-skill-implement-ct-5-ac-ct-9-floor-reads-stamp-then-radius, task-skill-test-ct-9-plan-gate-on-merged-main |
| AC-CT-10 | 88 | The scan was red-first (script absent) and is now green with 0 violations. CT-6b recorded a real falsifier: re-introducing a raw switch made the scan exit 1. The allowlist went from 2 entries to 1. | task-skill-implement-ct-6-ac-ct-10-capture-source-bucket-site, task-skill-refactor-ct-6b-one-stamp-verdict-derivation-in-core, task-skill-test-ct-9-plan-gate-on-merged-main |

## Gaps

(none)

## Recommendations

- Have CT-9 record lore verify evidence for AC-CT-6's tombstone command and show the ownership-check output.
- Require an expected-fail evidence row for each mandatory falsifier an AC names.
- Split unrelated infrastructure changes into their own plan.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 50551ms
- Retried: false
- Truncated sections: spec, diff:packages/lore/tests/unit/scripts/check-capture-source-buckets.test.ts, diff:packages/lore/tests/unit/service/stamp-types-compile-fail.fixture.ts, diff:packages/lore/tests/unit/service/stamp-types.test.ts, diff:scripts/check-capture-source-buckets.ts, diff:package.json, diff:packages/core/tests/home-dir-node.test.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/git-state-stamp.ts, diff:packages/lore/src/service/stamp-binding-reader.ts, diff:packages/lore/src/service/state-binding-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/verification-projection-service.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts, diff:packages/lore/tests/e2e/ac-command-pipe-compiled.bun.test.ts, diff:packages/lore/tests/e2e/ac-falsifier-range-compiled.bun.test.ts, diff:packages/lore/tests/e2e/ac-set-correction-compiled.bun.test.ts, diff:packages/lore/tests/e2e/baseline-rollback.bun.test.ts, diff:packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/context-verbs-compiled.bun.test.ts, diff:packages/lore/tests/e2e/done-worktree-cleanup-compiled.bun.test.ts, diff:packages/lore/tests/e2e/evidence-cd-chain-precheck-compiled.bun.test.ts, diff:packages/lore/tests/e2e/evidence-completeness-guard-compiled.bun.test.ts, diff:packages/lore/tests/e2e/evidence-dropped-file-guard-compiled.bun.test.ts, diff:packages/lore/tests/e2e/foreign-corpus-write-default.bun.test.ts, diff:packages/lore/tests/e2e/foreign-corpus-write-guard.bun.test.ts, diff:packages/lore/tests/e2e/issue-check.bun.test.ts, diff:packages/lore/tests/e2e/issue-close-on-archive-compiled.bun.test.ts, diff:packages/lore/tests/e2e/issue-closed-state.bun.test.ts, diff:packages/lore/tests/e2e/issue-closure-e2e.bun.test.ts, diff:packages/lore/tests/e2e/issue-closure.bun.test.ts, diff:packages/lore/tests/e2e/issue-task-done-close-compiled.bun.test.ts, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts, diff:packages/lore/tests/e2e/plan-close-known-false-pass.bun.test.ts, diff:packages/lore/tests/e2e/plan-exempt-attestation-compiled.bun.test.ts, diff:packages/lore/tests/e2e/rs-context-selection-cli.bun.test.ts, diff:packages/lore/tests/e2e/rs-fragments-check-duplicates.bun.test.ts, diff:packages/lore/tests/e2e/rs-skill-delivery-cli.bun.test.ts, diff:packages/lore/tests/e2e/rs-status-check-fragments.bun.test.ts, diff:packages/lore/tests/e2e/rs-user-config-resolver.bun.test.ts, diff:packages/lore/tests/e2e/rule-change-set-compiled.bun.test.ts, diff:packages/lore/tests/e2e/run-occupancy-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-check-sweep-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-corpus-resolution.bun.test.ts, diff:packages/lore/tests/helpers/clean-tree-repo.ts, diff:packages/lore/tests/helpers/cli-live-rule.ts, diff:packages/lore/tests/helpers/run-lore-in-process.ts, diff:packages/lore/tests/integration/anchor-coverage-surface.test.ts, diff:packages/lore/tests/integration/archive-apply-done-floors.bun.test.ts, diff:packages/lore/tests/integration/archive-sweep-cli.bun.test.ts, diff:packages/lore/tests/integration/audit-anchor.bun.test.ts, diff:packages/lore/tests/integration/cli-feed-task-start.bun.test.ts, diff:packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/in-process-parity.test.ts, diff:packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts, diff:packages/lore/tests/unit/scripts/check-capture-source-buckets.test.ts, diff:packages/lore/tests/unit/service/stamp-currency-floor.test.ts, diff:packages/lore/tests/unit/service/unmeasured-floor-consequence.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:scripts/changed-tests.ts, diff:scripts/check-capture-source-buckets.ts, diff:scripts/run-tests.ts, diff:scripts/selector-miss-report.ts, diff:scripts/test-budget-ledger.json, diff:scripts/test-global-setup.ts, diff:scripts/tests/selector-miss-report.test.ts, diff:scripts/tests/test-tree-snapshot-guard.test.ts, diff:scripts/tree-snapshot-guard.ts, diff:package.json, diff:packages/lore/tests/unit/scripts/check-capture-source-buckets.test.ts, diff:scripts/ac-oracle-not-built-ledger.json, diff:scripts/check-capture-source-buckets.ts, diff:packages/core/src/evidence-panel.ts, diff:packages/core/src/index.ts, diff:packages/core/src/stamp-binding.ts, diff:packages/core/src/task-workflow.ts, diff:packages/lore/src/adapters/cli/commands/audit.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/predicate-contracts.ts, diff:packages/lore/src/service/stamp-binding-reader.ts, diff:packages/lore/src/service/state-binding-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/verification-projection-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/stamp-currency-floor.test.ts, diff:packages/lore/tests/unit/service/stamp-types-compile-fail.fixture.ts, diff:packages/lore/tests/unit/service/stamp-types.test.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/adapters/oracle-occupancy.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/state-binding-skip.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/unit/service/occupancy-skip-continuity.test.ts, diff:scripts/oracle-lock.ts, diff:packages/core/src/task-workflow.ts, diff:packages/lore/src/service/verify-runner-service.ts, diff:packages/lore/tests/unit/service/stamp-pre-post-demotion.test.ts, diff:packages/lore/tests/unit/service/stamp-types.test.ts, diff:packages/core/src/acceptance.test.ts, diff:packages/core/src/oracle-file-existence.ts, diff:packages/core/tests/unit/bootstrap-injection-contract.test.ts, diff:packages/core/tests/unit/vitest-bun-segment-recognition.test.ts, diff:packages/lore/src/adapters/real-git-port.ts, diff:packages/lore/src/service/ai-provider-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/git-diff-since.ts, diff:packages/lore/src/service/rule-state-git-port.ts, diff:packages/lore/tests/unit/adapters/blast-radius-staleness.test.ts, diff:packages/lore/tests/unit/service/ai-provider-service-comment-currency.test.ts, diff:scripts/check-ac-oracle-ownership.ts, diff:scripts/check-corpus-fail-census.ts, diff:scripts/tests/check-corpus-fail-census.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | All six in-scope ACs have attested passes on main, with red-first runs. The AC-CT-6 retirement is unverified. |
| evidence_integrity | 70 | 0.6 | evidence | Attested runs with red-first. Most falsifiers have no runs, CT-1/R1 evidence is scratchpad scripts, and the ledger check output is not shown. |
| scope_fidelity | 62 | 0.6 | evidence | The diff carries unrelated HOME and in-process runner infrastructure. CT-3b and CT-6b are explained follow-ups. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Have CT-9 record lore verify evidence for AC-CT-6's tombstone command and show the ownership-check output. | The exit criteria name both, and neither is visibly evidenced. |
| process | Require an expected-fail evidence row for each mandatory falsifier an AC names. | Only AC-CT-10 has a recorded falsifier run. |
| process | Split unrelated infrastructure changes into their own plan. | Keeps the diff traceable to the tasks that own it. |

## Unverifiable Materials

- AC-CT-1/AC-CT-2 prior attested evidence: The overview cites earlier attested passes, but they are not in these materials.
- CT-1 and R1 scratchpad check scripts: The /private/tmp scripts and their output are not shown.
- check:ac-oracle-ownership output: tail_bytes is 3351 but no tail is shown, so the empty AC-CT ledger cannot be confirmed.
- omitted production files (oracle-occupancy.ts, git-state-stamp.ts, stamp-binding-reader.ts): Truncated from the diff, so the implementation cannot be inspected.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 3
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 3
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

4 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] No AC-CT-6 evidence row exists. The retirement and the check:spec-mirror wiring in package.json are not evidenced by the AC's own command. — "package.json" was never shown to the judge (omitted from the truncated diff)
- [minor] The exit criterion that scripts/ac-oracle-not-built-ledger.json holds no AC-CT row is evidenced only by a check:ac-oracle-ownership pass with no output tail shown. — "scripts/ac-oracle-not-built-ledger.json" was never shown to the judge (omitted from the truncated diff)
- [minor] unboundReasonOf in packages/core/src/stamp-binding.ts throws inside a pure tally. A malformed unbound reason would crash evidence-panel consumers instead of being counted. — "packages/core/src/stamp-binding.ts" was never shown to the judge (omitted from the truncated diff)
- [minor] The diff adds unrelated test-infrastructure changes: packages/core/src/home-dir-node.ts, packages/lore/src/adapters/cli/run-cli.ts, the stdio interceptor in packages/lore/src/adapters/cli/stdio-sync.ts, and scripts/test-isolation-ledger.json. No task in this plan owns them. — "packages/core/src/home-dir-node.ts" not found at commit 7786f8e99f4bf12dca373fb149a282b6ebd7e10a

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 11 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.85
