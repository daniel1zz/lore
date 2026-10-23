---
id: KN-639
type: knowledge
role: knowledge
title: "Assessment: Baseline slice 2a: AC write chokepoint, claim-scoped corpus authoring, indexes, completeness census, citation gate, rule read path (2026-10-08)"
status: archived
priority: medium
created: 2026-10-08
updated: 2026-10-23
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
| AC-BLS2-1 | 88 | 24-test chokepoint suite passes on main (attested x3 at review). The diff shows applyAcChange wired into CorpusService.set/create, restore, import and the AcService verbs, with actor provenance replacing 'system'. The AC was re-baselined so create is allowed through the gate; this is disclosed. The… | task-skill-implement-ac-write-chokepoint-actor-provenance-on-ac, task-skill-review-verify-ac-bls2-1-12-on-main-full-suite-assess |
| AC-BLS2-2 | 85 | 46 cite-gate tests pass on main (attested). One intermediate fail during implementation was later fixed. The ac-cite-gate.ts source is not shown, and the p95 latency case and feeding-pack contents are known only from test names. | task-skill-implement-citation-gate-three-state-mode-per-branch |
| AC-BLS2-3 | 86 | The race test and the cite-gate-in-tx test both pass on main. The oracle was strengthened after an audit found the race test could not falsify the in-transaction read (disclosed). A void v3 red row was explained in R7. | task-skill-test-red-retire-vs-cite-race-ac-bls2-3, task-skill-review-verify-ac-bls2-1-12-on-main-full-suite-assess |
| AC-BLS2-4 | 85 | The migration-014 suite passes, including a negative control. The diff shows countIndexMismatch, the status render and LATEST_SCHEMA_VERSION=14. Trigger-based index writes are an accepted deviation with a disclosed hazard if a future migration recreates docs. | task-skill-implement-migration-014-registry-lifecycle-version |
| AC-BLS2-5 | 84 | 17 census tests and the CLI baseline-coverage e2e pass. Interface dispatch is reported as not_measured. site-census.ts is not shown, and the comparison against a grep of 'return err(' is not visible in the evidence. | task-skill-implement-census-fidelity-interface-calls-as-not, task-skill-implement-site-census-typescript-compiler-api-leaf |
| AC-BLS2-6 | 85 | 12 rule show/find/impact tests pass on main, including the 3-leaf cycle. The MCP parity evidence (the -t mcp run) is not visible in the evidence tails. | task-skill-implement-rulereadservice-impactservice-lore-rule |
| AC-BLS2-7 | 86 | 8 governing-rules tests pass on main (attested). The list of feed-importer tests required by the task AC is not visible. | task-skill-implement-task-start-feed-governing-rules-section |
| AC-BLS2-8 | 82 | The integration test passes on main. The diff shows corpus_scope on the lease, CorpusWriteAuthority, and authorization on every RuleService writer. The RED test needed an orchestrator fix for the depth of its get --json read (#56). authorizeCite does a full scan of baseline docs (#63). | task-skill-implement-claim-scoped-corpus-intent-on-the-lease |
| AC-BLS2-9 | 90 | Test passes. The diff narrows findMany to 4 types and keeps corpus_version through a maxDocVersion aggregate implemented in all 3 stores. The before/after wall-time figure is not shown. | task-skill-implement-narrow-rulestateservice-loadsnapshot-to-4 |
| AC-BLS2-10 | 86 | 13 exemption tests pass on main (attested), covering the 8-way race cap. The exemption service source is not shown. | task-skill-implement-criterion-exemptions-reason-expiry-actor |
| AC-BLS2-11 | 82 | The rollback e2e passes (15 tests) and was red-first by mutation. The AC statement was re-baselined to fit the mode-off-with-baseline-docs behaviour (disclosed), which weakens 'byte-identical'. | task-skill-test-rollback-e2e-mode-off-no-baseline-docs-leaves |
| AC-BLS2-12 | 55 | A from-source run on main finally passed, but the shipped binary fails (typescript-unavailable, #58) and the AC was rewritten to run from source. An earlier main run listed StoreInterface not_measured sites. The pass tail does not show the summary lines, and the starting counts were echoed strings. | task-skill-review-verify-ac-bls2-1-12-on-main-full-suite-assess, task-skill-implement-completeness-backfill-execution-branch, task-skill-implement-completeness-backfill-specification-branch |
| AC-BLS2-13 | 10 | Explicitly out of scope for slice 2a: per-branch migration plans. There is no evidence. Mitigated by the plan's declared scope, but the plan sets no ac_scope. | — |
| AC-BLS2-14 | 10 | Explicitly deferred to slice 2c. There is no evidence. Mitigated by the plan's declared scope, but the plan sets no ac_scope. | — |
| AC-BLS2-15 | 86 | 9 fidelity tests pass on main, covering non-err sites, field-distinct keys and node_modules-layout-independent keys. The AC was added mid-plan with disclosure. The required byte-identical diff output for main vs worktree is not visible. | task-skill-implement-census-typed-error-sites-field-distinct |

## Gaps

- The census fails in the built binary with typescript-unavailable. The AC was re-scoped to run from source with packages/lore/src/index.ts, and the binary defect is deferred to #58.
- The backfill starting gap counts were recorded as echoed strings, not captured output, and the full-suite gate is one self-reported manual row.
- AC-BLS2-1, 3, 11 and 12 were re-baselined mid-plan, and Invariant 6's pre-existing red list was extended after execution.
- AcService.authorizeCite in packages/lore/src/service/ac-service.ts loads every baseline doc on each cite (#63).

## Recommendations

- Declare extra.ac_scope to exclude AC-BLS2-13 and AC-BLS2-14 so the assessment does not count them as in-scope misses.
- Require the full-suite gate to be captured with an attested oracle, with the red-list diff computed mechanically.
- Restore the binary-path oracle for AC-BLS2-12 once #58 is fixed.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 43603ms
- Retried: false
- Truncated sections: plan, diff:packages/lore/tests/fixtures/site-census/command.ts, diff:packages/lore/tests/fixtures/site-census/service.ts, diff:packages/lore/tests/unit/service/site-census.test.ts, diff:packages/lore/tests/unit/service/ac-write-chokepoint.test.ts, diff:packages/lore/tests/unit/service/rule-state-snapshot-scope.test.ts, diff:packages/lore/tests/integration/cli/corpus-scope-lease.bun.test.ts, diff:packages/lore/tests/unit/store/migration-014.bun.test.ts, diff:packages/lore/tests/unit/service/ac-exempt.test.ts, diff:packages/lore/tests/unit/service/rule-read-impact.test.ts, diff:packages/lore/tests/unit/service/cite-gate.test.ts, diff:packages/lore/tests/fixtures/cite-retire-race-worker.ts, diff:packages/lore/tests/unit/store/cite-retire-race.bun.test.ts, diff:packages/lore/tests/unit/service/feed-governing-rules.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/in-memory-store.test.ts, diff:packages/lore/tests/unit/store/sqlite-store.bun.test.ts, diff:packages/lore/tests/unit/store/turso-store.bun.test.ts, diff:packages/lore/tests/integration/gate-spec-promote.bun.test.ts, diff:packages/lore/tests/unit/service/ac-write-chokepoint.test.ts, diff:packages/lore/tests/unit/service/plan-ac-scope-staleness.test.ts, diff:packages/lore/tests/unit/service/corpus-scope-guard.test.ts, diff:packages/lore/tests/integration/cli/corpus-scope-lease.bun.test.ts, diff:packages/lore/src/store/index-rows.ts, diff:packages/lore/src/store/migrations/migration-014.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/service/baseline-create-guard.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/migration-012.bun.test.ts, diff:packages/lore/tests/unit/store/migration-013.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/ac.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/service/ac-exemption-service.ts, diff:packages/lore/src/service/baseline-status.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/ac-exemptions.bun.test.ts, diff:packages/core/src/baseline.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/service/leaf-coverage.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/src/service/site-census.ts, diff:packages/lore/tests/fixtures/site-census/iface/command.ts, diff:packages/lore/tests/fixtures/site-census/iface/store.ts, diff:packages/lore/tests/integration/cli/baseline-coverage.bun.test.ts, diff:packages/lore/tests/unit/service/rule-service-site-map.test.ts, diff:packages/lore/tests/unit/service/site-census.test.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/service/leaf-coverage.ts, diff:packages/lore/src/service/site-census-nonbusiness.ts, diff:packages/lore/src/service/site-census.ts, diff:packages/lore/src/adapters/cli/commands/rule.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/impact-service.ts, diff:packages/lore/src/service/rule-index-loader.ts, diff:packages/lore/src/service/rule-index-queries.ts, diff:packages/lore/src/service/rule-read-service.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/service/rule-read-anchor-suffix.test.ts, diff:packages/lore/src/adapters/cli/task-feed-render.ts, diff:packages/lore/src/adapters/cli/task-feed-wiring.ts, diff:packages/lore/src/flows/task-feed-flow.ts, diff:packages/lore/src/service/governing-rules.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/package.json, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/app/package.json, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/app/src/cli.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/app/src/service.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/package.json, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/src/errors.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/src/index.ts, diff:packages/lore/tests/fixtures/site-census-fidelity/packages/fxcore/src/validate.ts, diff:packages/lore/tests/unit/service/site-census-fidelity.test.ts, diff:packages/lore/src/service/site-census.ts, diff:packages/core/src/config.ts, diff:packages/core/src/errors.ts, diff:packages/lore/src/adapters/cli/utils.ts, diff:packages/lore/src/adapters/http/middleware.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/eval/scenarios/placeholder-parse.ts, diff:packages/lore/src/service/ac-cite-gate.ts, diff:packages/lore/src/service/ac-exemption-service.ts, diff:packages/lore/src/service/ac-service.ts, diff:packages/lore/src/service/ac-write-chokepoint.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/integration/phase-write-audit-pairing.test.ts, diff:packages/lore/tests/unit/core/config-ac-cite.test.ts, diff:packages/lore/tests/unit/service/cite-gate-create.test.ts, diff:packages/lore/tests/unit/service/cite-gate-report-unarmed.test.ts, diff:packages/lore/tests/unit/service/cite-gate-wiring.bun.test.ts, diff:packages/lore/tests/unit/store/cite-gate-in-tx.bun.test.ts, diff:packages/lore/tests/unit/service/cite-gate.test.ts, diff:packages/lore/tests/unit/service/cite-gate.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts
- Reasoning clipped for: AC-BLS2-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.7 | evidence | 12 of the 13 in-scope ACs pass attested on main. The census fails in the binary, and AC-BLS2-12 holds from source only. |
| evidence_integrity | 72 | 0.65 | evidence | High attestation ratio and red-first rows. Caveats: echoed start counts, a void red run, test fixes by the orchestrator, a manual full-suite row, and truncated pass tails for AC-12. |
| scope_fidelity | 68 | 0.6 | evidence | Several AC re-baselines, AC-15 added mid-plan, the invariant list extended after the fact, and an accepted out-of-anchor setSiteMap. All disclosed, but this is significant drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BLS2-12 | The census fails in the built binary with typescript-unavailable. The AC was re-scoped to run from source with packages/lore/src/index.ts, and the binary defect is deferred to #58. |
| evidence_integrity | minor | — | The backfill starting gap counts were recorded as echoed strings, not captured output, and the full-suite gate is one self-reported manual row. |
| scope_fidelity | minor | AC-BLS2-1 | AC-BLS2-1, 3, 11 and 12 were re-baselined mid-plan, and Invariant 6's pre-existing red list was extended after execution. |
| outcome | minor | AC-BLS2-8 | AcService.authorizeCite in packages/lore/src/service/ac-service.ts loads every baseline doc on each cite (#63). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Declare extra.ac_scope to exclude AC-BLS2-13 and AC-BLS2-14 so the assessment does not count them as in-scope misses. | The plan text excludes them, but the machine facts treat them as in scope. |
| process | Require the full-suite gate to be captured with an attested oracle, with the red-list diff computed mechanically. | Manual rows and red lists extended afterwards weaken Invariant 6. |
| spec | Restore the binary-path oracle for AC-BLS2-12 once #58 is fixed. | Running from source hides a distribution defect. |

## Unverifiable Materials

- packages/lore/src/service/site-census.ts, ac-cite-gate.ts, migration-014.ts: Omitted from the diff, so the implementation quality of the census, the gate and the migration cannot be checked.
- AC-BLS2-12 pass output summary lines: The tail shows only bootstrap lines; the 0-gap summary is not visible.
- Full-suite run output: The manual row's content is not shown.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 15 declared criteria
- Task evidence: 27 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.99
