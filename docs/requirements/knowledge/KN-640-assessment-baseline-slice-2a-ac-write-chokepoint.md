---
id: KN-640
type: knowledge
role: knowledge
title: "Assessment: Baseline slice 2a: AC write chokepoint, claim-scoped corpus authoring, indexes, completeness census, citation gate, rule read path (2026-10-08)"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
links:
  - {id: PLAN-178, type: informs}
---
# Assessment: partially_met (71/100)

Scope: plan `01M4CXTBTSX2SDCJQGMBAFKRKH`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-1 | 90 | 7 attested passes on main (24 tests). Diff shows applyAcChange wired into set/create/restore/import plus actor provenance. The plan's grep oracle for chokepoint bypasses has no visible output in the evidence. | task-skill-implement-ac-write-chokepoint-actor-provenance-on-ac, task-skill-review-verify-ac-bls2-1-12-on-main-full-suite-assess |
| AC-BLS2-2 | 82 | 46 tests pass on main, attested 3 times in the verify task. The one fail was mid-implementation. The required p95<=50ms latency case is not visible in any evidence tail, and the gate source is truncated. | task-skill-implement-citation-gate-three-state-mode-per-branch |
| AC-BLS2-3 | 88 | The race test and the in-tx test both pass on main, and the in-tx test includes a retire committed between the early read and the write. The implementation (ac-cite-gate.ts) is unseen. | task-skill-implement-citation-gate-three-state-mode-per-branch |
| AC-BLS2-4 | 85 | migration-014 test (13 tests) passes on main, and index_mismatch is visible in status. Invariant 5 (sync-push, migration chain, ordinal check) has no pasted evidence. The in-memory store derives its index rows from documents, so it can never show a mismatch. | task-skill-implement-migration-014-registry-lifecycle-version |
| AC-BLS2-5 | 85 | 17 census tests pass on main. The plan's '>=10 sites' and grep-comparison oracles have no visible output tails. | task-skill-implement-site-census-typescript-compiler-api-leaf, task-skill-implement-census-fidelity-interface-calls-as-not |
| AC-BLS2-6 | 87 | 12 tests pass on main, attested repeatedly. MCP parity for lore_rule_* is not evidenced beyond a typecheck. | task-skill-implement-rulereadservice-impactservice-lore-rule |
| AC-BLS2-7 | 88 | 8 tests pass on main. The required list of feed-importer tests (test:changed) is not shown. | task-skill-implement-task-start-feed-governing-rules-section |
| AC-BLS2-8 | 86 | Integration test passes on main; the earlier fail was mid-implementation. The diff shows the lease field, MCP parity, guard and audit row. authorizeCite scans every baseline doc before the inert short-circuit. | task-skill-implement-claim-scoped-corpus-intent-on-the-lease |
| AC-BLS2-9 | 92 | 6 tests pass on main. The diff narrows findMany to 4 types and keeps corpus_version via maxDocVersion in all three stores. The before/after wall time is not recorded (informational only). | task-skill-implement-narrow-rulestateservice-loadsnapshot-to-4 |
| AC-BLS2-10 | 87 | 13 tests pass on main, including the 8-way race. The service source is unseen. | task-skill-implement-criterion-exemptions-reason-expiry-actor |
| AC-BLS2-11 | 88 | Rollback e2e (15 tests) passes on main. An expected-fail by mutation is recorded on the task. | task-skill-test-rollback-e2e-mode-off-no-baseline-docs-leaves |
| AC-BLS2-12 | 55 | Passes only when run from source. The built binary fails because typescript is unavailable (#58), and the verify command was reworded to bypass that. The visible tails never show the 0-gap summary line. The spec backfill started at 93 gaps with no evidenced per-leaf split. | task-skill-implement-completeness-backfill-specification-branch, task-skill-implement-completeness-backfill-execution-branch |
| AC-BLS2-13 | 5 | No evidence. The plan explicitly defers it to the per-branch migration plans (mitigation noted). | — |
| AC-BLS2-14 | 5 | No evidence. The plan explicitly defers it to slice 2c (mitigation noted). | — |
| AC-BLS2-15 | 85 | 9 tests pass on main, red-first recorded. The byte-identical worktree diff and the 'scope add' sites listing required by the task have no visible output. | task-skill-implement-census-typed-error-sites-field-distinct |

## Gaps

- The site census fails in the compiled binary (Cannot find package 'typescript'), so `lore baseline coverage` is unusable as shipped. The pass is from source only.
- Both backfill tasks' starting-gap evidence is an echoed literal string, not measured output. Final tails are truncated before the 0-gap summary line.
- Verify task is draft. The full suite (Invariant 6), lore assess, check-drift, module docs and handoff are all unevidenced.
- The spec backfill started at 93 gaps, above the plan's 60-gap split threshold. No per-leaf split was evidenced.
- authorizeCite runs findMany over all baseline docs before the inert-crossing short-circuit, adding a full scan to every armed ac cite.

## Recommendations

- Add a task to make the census work from the built binary (#58) and re-attest AC-BLS2-12 with the binary command.
- Require backfill baseline counts to be captured command output, never echo literals.
- Record the AC-BLS2-12 verify-command change and the AC-BLS2-15 addition in the amendment log.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 48707ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/fixtures/site-census/command.ts, diff:packages/lore/tests/fixtures/site-census/service.ts, diff:packages/lore/tests/unit/service/site-census.test.ts, diff:packages/lore/tests/unit/service/ac-write-chokepoint.test.ts, diff:packages/lore/tests/unit/service/rule-state-snapshot-scope.test.ts, diff:packages/lore/tests/integration/cli/corpus-scope-lease.bun.test.ts, diff:packages/lore/tests/unit/store/migration-014.bun.test.ts, diff:packages/lore/tests/unit/service/ac-exempt.test.ts, diff:packages/lore/tests/unit/service/rule-read-impact.test.ts, diff:packages/lore/tests/unit/service/cite-gate.test.ts, diff:packages/lore/tests/fixtures/cite-retire-race-worker.ts, diff:packages/lore/tests/unit/store/cite-retire-race.bun.test.ts, diff:packages/lore/tests/unit/service/feed-governing-rules.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/in-memory-store.test.ts, diff:packages/lore/tests/unit/store/sqlite-store.bun.test.ts, diff:packages/lore/tests/unit/store/turso-store.bun.test.ts, diff:packages/lore/tests/integration/gate-spec-promote.bun.test.ts, diff:packages/lore/tests/unit/service/ac-write-chokepoint.test.ts, diff:packages/lore/tests/unit/service/plan-ac-scope-staleness.test.ts, diff:packages/lore/tests/unit/service/corpus-scope-guard.test.ts, diff:packages/lore/tests/integration/cli/corpus-scope-lease.bun.test.ts, diff:packages/lore/src/store/index-rows.ts, diff:packages/lore/src/store/migrations/migration-014.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/service/baseline-create-guard.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/migration-012.bun.test.ts, diff:packages/lore/tests/unit/store/migration-013.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/ac.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/service/ac-exemption-service.ts, diff:packages/lore/src/service/baseline-status.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/ac-exemptions.bun.test.ts, diff:packages/core/src/baseline.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/service/leaf-coverage.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/src/service/site-census.ts, diff:packages/lore/tests/fixtures/site-census/iface/command.ts, diff:packages/lore/tests/fixtures/site-census/iface/store.ts, diff:packages/lore/tests/integration/cli/baseline-coverage.bun.test.ts, diff:packages/lore/tests/unit/service/rule-service-site-map.test.ts, diff:packages/lore/tests/unit/service/site-census.test.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/service/leaf-coverage.ts, diff:packages/lore/src/service/site-census-nonbusiness.ts, diff:packages/lore/src/service/site-census.ts, diff:packages/lore/src/adapters/cli/commands/rule.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/impact-service.ts, diff:packages/lore/src/service/rule-index-loader.ts, diff:packages/lore/src/service/rule-index-queries.ts, diff:packages/lore/src/service/rule-read-service.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/service/rule-read-anchor-suffix.test.ts, diff:packages/lore/src/adapters/cli/task-feed-render.ts, diff:packages/lore/src/adapters/cli/task-feed-wiring.ts, diff:packages/lore/src/flows/task-feed-flow.ts, diff:packages/lore/src/service/governing-rules.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/package.json, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/app/package.json, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/app/src/cli.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/app/src/service.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/package.json, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/src/errors.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/src/index.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/src/validate.ts, diff:packages/lore/tests/unit/service/site-census-fidelity.test.ts, diff:packages/lore/src/service/site-census.ts, diff:packages/core/src/config.ts, diff:packages/core/src/errors.ts, diff:packages/lore/src/adapters/cli/utils.ts, diff:packages/lore/src/adapters/http/middleware.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/eval/scenarios/placeholder-parse.ts, diff:packages/lore/src/service/ac-cite-gate.ts, diff:packages/lore/src/service/ac-exemption-service.ts, diff:packages/lore/src/service/ac-service.ts, diff:packages/lore/src/service/ac-write-chokepoint.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/integration/phase-write-audit-pairing.test.ts, diff:packages/lore/tests/unit/core/config-ac-cite.test.ts, diff:packages/lore/tests/unit/service/cite-gate-create.test.ts, diff:packages/lore/tests/unit/service/cite-gate-report-unarmed.test.ts, diff:packages/lore/tests/unit/service/cite-gate-wiring.bun.test.ts, diff:packages/lore/tests/unit/store/cite-gate-in-tx.bun.test.ts, diff:packages/lore/tests/unit/service/cite-gate.test.ts, diff:packages/lore/tests/unit/service/cite-gate.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 74 | 0.7 | evidence | 12 of 13 in-scope script ACs attested pass on main. AC-12 passes only from source because the binary census is broken. Exit criteria are not done. |
| evidence_integrity | 68 | 0.65 | evidence | All evidence attested and red-first recorded, but backfill start counts are echoed strings, AC-12's oracle was reworded, and several pasted-output oracles are missing. |
| scope_fidelity | 72 | 0.6 | evidence | Mostly on plan. AC-15 and its census rework were added via issues; the >60-gap split rule was not followed visibly; the AC-12 oracle was weakened. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BLS2-12 | The site census fails in the compiled binary (Cannot find package 'typescript'), so `lore baseline coverage` is unusable as shipped. The pass is from source only. |
| evidence_integrity | major | AC-BLS2-12 | Both backfill tasks' starting-gap evidence is an echoed literal string, not measured output. Final tails are truncated before the 0-gap summary line. |
| outcome | major | — | Verify task is draft. The full suite (Invariant 6), lore assess, check-drift, module docs and handoff are all unevidenced. |
| scope_fidelity | minor | AC-BLS2-12 | The spec backfill started at 93 gaps, above the plan's 60-gap split threshold. No per-leaf split was evidenced. |
| outcome | minor | AC-BLS2-8 | authorizeCite runs findMany over all baseline docs before the inert-crossing short-circuit, adding a full scan to every armed ac cite. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a task to make the census work from the built binary (#58) and re-attest AC-BLS2-12 with the binary command. | Users run the binary, not the source. |
| process | Require backfill baseline counts to be captured command output, never echo literals. | Echoed numbers are self-reported. |
| spec | Record the AC-BLS2-12 verify-command change and the AC-BLS2-15 addition in the amendment log. | Changing an oracle mid-plan needs a traceable decision. |

## Unverifiable Materials

- site-census.ts, ac-cite-gate.ts, migration-014.ts, ac-exemption-service.ts source: Listed in the truncation manifest; their quality cannot be assessed beyond test results.
- Full suite run on main: No evidence record present.
- AC-BLS2-2 p95 latency case: Not shown in any evidence tail.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 15 declared criteria
- Task evidence: 27 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
