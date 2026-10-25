---
id: KN-436
type: knowledge
role: knowledge
title: "Assessment: Land read-side reachability: enumerable trace counts, knowledge code anchors under check-drift, and a store-level sub-type filter (2026-08-12)"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-10-23
tags: []
parent: PLAN-126
links:
  - {id: PLAN-126, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KZRHXWH28Q78R22ZVQDEXAK1`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RR-1 | 90 | Attested RED then GREEN (5 pass) on trace-enumerate-never-read.bun.test.ts. Diff shows listNeverReadDocs returning {id,slug} with count derived as list.length in TraceStatsService, so count==members.length by construction. | 01KZRJ0BSA81A3V51KGPQ15E5A (evidence [1] expected-fail, [4]/[8] pass) |
| AC-RR-2 | 90 | Attested RED then GREEN (5 pass). commands/trace.ts builds a VALIDATION_ERROR naming the field plus the sorted registry keys (both registered fields) and exits via exitCode(); registry is typed Record<TraceStatsCountField,…>. | 01KZRJ0BSA81A3V51KGPQ15E5A (evidence [2] expected-fail, [5]/[9] pass) |
| AC-RR-3 | 88 | Attested RED then GREEN (4 pass). Store layer omits the `query` key entirely unless includeRawQueries; sqlite + in-memory both shown implementing the same absent-vs-empty projection. Turso implementation unseen (truncated). | 01KZRJ0BSA81A3V51KGPQ15E5A (evidence [3] expected-fail, [6]/[10] pass) |
| AC-RR-4 | 88 | Attested RED then GREEN (11 pass) on knowledge-code-anchor-drift.bun.test.ts, including a BOUNDARY case asserting knowledge_checked 0 / specs_checked 1. Diff shows ANCHOR_SCANNED_DOC_TYPES driving both scan and anchor dispatch. | 01KZRJ0BZRDA2TCBM929WG1XXC (evidence [1] expected-fail, [3]/[6] pass) |
| AC-RR-5 | 82 | Attested RED with a specific reason (unknown flag) then GREEN, incl. the --limit 1 --offset 1 BOUNDARY case. Store predicate placement not directly visible: list.ts and all three store files are truncated, so store-query vs post-filter rests on the test. | 01KZRJ0C6H00G8XB4WT9BPNH4A (evidence [1] expected-fail, [4] pass) |
| AC-RR-6 | 85 | Attested RED then GREEN (7 tests). RED note shows the oracle discriminates the pre-existing strict-flag exit 2 via not.toContain('Unknown option'), which is the right guard against a false green. | 01KZRJ0C6H00G8XB4WT9BPNH4A (evidence [2] expected-fail, [5] pass) |
| AC-RR-7 | 82 | Attested RED then GREEN (6 tests) with both-directions discrimination and a BOUNDARY case. search.ts and store files truncated, so implementation placement is inferred from test behaviour only. | 01KZRJ0C6H00G8XB4WT9BPNH4A (evidence [3] expected-fail, [6] pass) |
| AC-RR-8 | 88 | Attested RED then GREEN (13 tests). Diff shows knowledge_checked added to DriftCheckResult and CodeDriftPayload and threaded through runDrift plus status render. Census half passes but its tail notes remaining doc/ prose occurrences. | 01KZRJ0BZRDA2TCBM929WG1XXC (evidence [2] expected-fail, [4]/[7] pass) |
| AC-RR-9 | 80 | Attested RED then GREEN (8 tests) driven through the MCP handler with refusal + valid-entry control. corpus-service.ts and tools.ts are truncated, so the service-layer (not adapter) placement of the check is asserted only by the test's framing. | 01KZRN9N4DRY97QN8XWRGCVZKN (evidence [1] expected-fail, [2] pass) |
| AC-RR-10 | 85 | Attested RED then GREEN (6 tests) covering service behaviour, both shipped renderers, and a word-boundary census. Final diff hunk shows spec_id/spec_status renamed to doc_id/doc_status at the composition site; code-anchors.ts's own rename is truncated. | 01KZRN9MXQHCYQQHWNH81SR4MZ (evidence [1] expected-fail, [2] pass) |

## Gaps

- The shown hunk of packages/core/src/code-anchors.ts still declares spec_id and spec_status on DriftInputEntry/DriftRow, with a comment stating they 'keep their historical SPEC-045 names'. Only a later truncated revision plus the final drift-check-service.ts hunk show doc_id/doc_status. The census oracle reports green, but the rename itself is not visible in the reviewed diff.
- Task 01KZRJ0C6H00G8XB4WT9BPNH4A records evidence [7] `bun run test:changed` with result=fail and no follow-up green run or triage note. A broad changed-file suite failing after the store-interface edits is exactly the regression signal the AC-specific oracles cannot see.
- Task 01KZRJ0BZRDA2TCBM929WG1XXC records evidence [8] `bun test tests/e2e/migrate-ordinals-compiled.bun.test.ts` with result=fail and no resolution, alongside 9 passing runs. Left unexplained, a reader cannot tell whether the drift-row rename touched migration output.
- attested_evidence_ratio is 0.28 (10 of 36 records attested). Each AC has exactly one attested pass; every supporting regression, typecheck, and cross-package run is self-reported, so the non-AC safety net rests on unattested claims.
- AC-RR-5/6/7 turn on the sub_type predicate living in the store query, but packages/lore/src/adapters/cli/commands/list.ts, packages/lore/src/adapters/cli/commands/search.ts, packages/lore/src/store/store-interface.ts, packages/lore/src/store/sqlite-store.ts, packages/lore/src/store/turso-store.ts and packages/lore/src/store/in-memory-store.ts are all truncated. The limit/offset test is good indirect evidence but does not distinguish a store predicate from a pre-pagination in-memory filter in th…
- countArmedSpecs in packages/lore/src/flows/drift-flow.ts is deliberately left spec-only, so a corpus where only a knowledge doc declares anchors reports code_anchor_specs 0 while checkDrift reports armed:true. The divergence is documented in the doc comment but no oracle pins it, so a future reader may treat the 0 as 'nothing armed'.
- The MCP side-door fix (packages/lore/src/service/corpus-service.ts, packages/lore/src/adapters/mcp/tools.ts) and the doc_id/doc_status rename were added as tasks beyond the plan's declared Phase 1/2 field contract. Both are disclosed and AC-backed, but they edit files the plan's anchor comparison did not cover, so the cross-plan collision mitigation described in Risks no longer holds by construction.

## Recommendations

- Require that any evidence record with result=fail be followed by either a green re-run of the same command or an explicit triage note before a task moves to archived.
- For store-placement ACs like AC-RR-5/7, add a direct store-level assertion (e.g. findMany called with a sub_type predicate, or per-implementation query tests) rather than inferring placement from CLI pagination behaviour alone.
- When a plan renames a field contract, declare the FULL identity set up front (doc_id/doc_status/doc_slug/doc_type) instead of one field, so a follow-on rename task is not needed to finish the same coexistence hazard.
- Raise runner attestation beyond one record per AC — at minimum attest the final typecheck and full-suite runs per task.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 170278ms
- Retried: true
- Truncated sections: diff:packages/core/tests/code-anchors.test.ts, diff:packages/lore/tests/integration/cli/knowledge-code-anchor-drift.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-drift.bun.test.ts, diff:packages/lore/tests/unit/adapters/mcp-drift.test.ts, diff:packages/lore/tests/unit/service/drift-population-reporting.test.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/integration/cli/trace-enumerate-never-read.bun.test.ts, diff:packages/lore/tests/integration/cli/trace-enumerate-unregistered.bun.test.ts, diff:packages/lore/tests/integration/cli/trace-enumerate-zero-hit-privacy.bun.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/src/adapters/cli/commands/list.ts, diff:packages/lore/src/adapters/cli/commands/search.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/integration/cli/list-sub-type-filter.bun.test.ts, diff:packages/lore/tests/integration/cli/list-sub-type-usage-error.bun.test.ts, diff:packages/lore/tests/integration/cli/search-sub-type-filter.bun.test.ts, diff:packages/core/src/code-anchors.ts, diff:packages/core/tests/code-anchors.test.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/flows/drift-flow.ts, diff:packages/lore/tests/unit/adapters/cli-drift.bun.test.ts, diff:packages/lore/tests/unit/service/drift-row-doc-identity.test.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/tests/unit/adapters/mcp-knowledge-anchor-grammar.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.75 | evidence | All 10 ACs have an attested pass with a prior RED; the visible diff coherently implements M1/M2 and the drift rename. M3's store-query placement is evidenced only through CLI-level tests. |
| evidence_integrity | 78 | 0.7 | evidence | Every AC has one attested pass and a documented RED, several with reasoned RED notes. Weakened by 0.28 attestation ratio and two unexplained result=fail non-AC runs. |
| scope_fidelity | 88 | 0.7 | evidence | Diff matches the plan's three mechanisms and phase ordering. Two extra tasks (MCP side door, doc_id/doc_status rename) are follow-ons beyond the plan's declared field contract, but disclosed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-RR-10 | The shown hunk of packages/core/src/code-anchors.ts still declares spec_id and spec_status on DriftInputEntry/DriftRow, with a comment stating they 'keep their historical SPEC-045 names'. Only a later truncated revision plus the final drift-check-service.ts hunk show doc_id/doc_status. The census oracle reports green, but the rename itself is not visible in the reviewed diff. |
| evidence_integrity | major | AC-RR-5 | Task 01KZRJ0C6H00G8XB4WT9BPNH4A records evidence [7] `bun run test:changed` with result=fail and no follow-up green run or triage note. A broad changed-file suite failing after the store-interface edits is exactly the regression signal the AC-specific oracles cannot see. |
| evidence_integrity | minor | AC-RR-4 | Task 01KZRJ0BZRDA2TCBM929WG1XXC records evidence [8] `bun test tests/e2e/migrate-ordinals-compiled.bun.test.ts` with result=fail and no resolution, alongside 9 passing runs. Left unexplained, a reader cannot tell whether the drift-row rename touched migration output. |
| evidence_integrity | minor | AC-RR-7 | attested_evidence_ratio is 0.28 (10 of 36 records attested). Each AC has exactly one attested pass; every supporting regression, typecheck, and cross-package run is self-reported, so the non-AC safety net rests on unattested claims. |
| outcome | minor | AC-RR-5 | AC-RR-5/6/7 turn on the sub_type predicate living in the store query, but packages/lore/src/adapters/cli/commands/list.ts, packages/lore/src/adapters/cli/commands/search.ts, packages/lore/src/store/store-interface.ts, packages/lore/src/store/sqlite-store.ts, packages/lore/src/store/turso-store.ts and packages/lore/src/store/in-memory-store.ts are all truncated. The limit/offset test is good indirect evidence but does not distinguish a store predicate from a pre-pagination in-memory filter in th… |
| outcome | minor | AC-RR-8 | countArmedSpecs in packages/lore/src/flows/drift-flow.ts is deliberately left spec-only, so a corpus where only a knowledge doc declares anchors reports code_anchor_specs 0 while checkDrift reports armed:true. The divergence is documented in the doc comment but no oracle pins it, so a future reader may treat the 0 as 'nothing armed'. |
| scope_fidelity | minor | AC-RR-9 | The MCP side-door fix (packages/lore/src/service/corpus-service.ts, packages/lore/src/adapters/mcp/tools.ts) and the doc_id/doc_status rename were added as tasks beyond the plan's declared Phase 1/2 field contract. Both are disclosed and AC-backed, but they edit files the plan's anchor comparison did not cover, so the cross-plan collision mitigation described in Risks no longer holds by construction. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that any evidence record with result=fail be followed by either a green re-run of the same command or an explicit triage note before a task moves to archived. | Two failing runs (test:changed, migrate-ordinals-compiled) are archived with no resolution, leaving the regression picture ambiguous. |
| spec | For store-placement ACs like AC-RR-5/7, add a direct store-level assertion (e.g. findMany called with a sub_type predicate, or per-implementation query tests) rather than inferring placement from CLI pagination behaviour alone. | A pre-pagination adapter filter would satisfy the current limit/offset oracle while violating the AC's stated mechanism. |
| plan | When a plan renames a field contract, declare the FULL identity set up front (doc_id/doc_status/doc_slug/doc_type) instead of one field, so a follow-on rename task is not needed to finish the same coexistence hazard. | The doc_id/doc_status residual was created by the AC designer scoping the rename to spec_slug only. |
| process | Raise runner attestation beyond one record per AC — at minimum attest the final typecheck and full-suite runs per task. | attested_evidence_ratio 0.28 means most supporting runs are self-reported. |

## Unverifiable Materials

- packages/lore/src/store/turso-store.ts: Truncated from the diff; the raw-query privacy projection and sub_type predicate for this backend could not be inspected.
- packages/lore/src/adapters/cli/commands/list.ts and commands/search.ts: Truncated; the --sub-type flag wiring and conflict refusal are evidenced only by CLI test output.
- packages/lore/src/service/corpus-service.ts: Truncated; whether the code_anchors grammar check now sits doc-type-agnostically at the service layer is asserted only by the MCP test.
- Final revision of packages/core/src/code-anchors.ts: The shown hunk retains spec_id/spec_status; the doc_id/doc_status rename in that file is in a truncated later revision.
- Full output of the two result=fail runs: Only tail_bytes lengths recorded for test:changed and migrate-ordinals-compiled; the failure content is not shown.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 10
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.28
