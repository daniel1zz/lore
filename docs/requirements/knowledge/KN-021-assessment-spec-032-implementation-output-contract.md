---
id: KN-021
type: knowledge
role: knowledge
title: "Assessment: SPEC-032 Implementation — output-contract mechanization (2026-07-06)"
status: archived
priority: medium
created: 2026-07-06
updated: 2026-10-23
tags: []
parent: PLAN-012
links:
  - {id: PLAN-012, type: informs}
---
# Assessment: partially_met (72/100)

Scope: plan `01KWV8QF5X8F7QE8855B1XVJTE`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-1 | 87 | spec-kind.ts enum SSOT, specExtraSchema optional under passthrough, superRefine validates spec extra (bogus→VALIDATION_ERROR), _createImpl defaults 'feature', CLI --kind wired. T1 evidence: tsc + vitest 2046/bun 556 pass. 108-spec regression asserted by evidence not shown in diff. | task-t1-spec-kind-enum-service-default-cli-kind |
| AC-2 | 48 | lore.tree.yaml blueprint file is ABSENT from the diff; no tree-check integration or negative-regression test appears in the diff either. Only T2 evidence text claims '20 tests, check-tree exit 0, misplaced+missing negatives'. Core deliverable unverifiable from materials — scored conservatively. | task-t2-lore-tree-yaml-blueprint-authoring-arming-negative-oracl (blueprint file not in diff) |
| AC-3 | 76 | renderResolvedToMarkdown implemented as pure fn, handles all 7 whitelisted components with graceful degradation, descending-position splice. get.ts prints spliced body on non-raw. Round-trip regression test not in diff; T3 evidence claims live PRD §5 splice rendered. | task-t3-text-projection-splice-revive-resolve-mdx-renderresolved |
| AC-4 | 78 | export-docs uses injected resolveDocBody; SAME spliced body used for drift compare and write (avoids false drift) — visible and correct. app.ts wires callback. Build pass evidence. Drift-clean/round-trip test not shown in diff but design soundly prevents permanent drift. | task-t3-text-projection-splice-revive-resolve-mdx-renderresolved |
| AC-5 | 86 | migrate spec-kind subcommand + SpecKindService with dryRun (zero writes), idempotent skip of tech/design. spec-kind-audit heuristic with 209-line test file VISIBLE in diff. T4: 38 new tests pass. Strong, mostly verifiable. | task-t4-migrate-spec-kind-audit-dry-run-idempotent |
| AC-6 | 85 | evaluateReadiness gains parentSpecStatus param (default null → back-compat); sets upstream_unapproved only when non-null & !approved; never affects ready. Service fetches parent spec status; ready.ts prints advisory once. T5: 7 direct unit + 4 service tests. Test bodies not in diff. | task-t5-ready-upstream-unapproved-advisory |
| AC-7 | 40 | CONTRADICTS AC as worded: resolve_mdx stays deliberately DEAD, resolved_components on CorpusService.get() return 'Never populated' per new JSDoc; get.ts call drops the param. Splice moved to adapter layer (architecturally justified, no cross-service import) but literal AC-7 unmet; no CorpusService … | task-t3-text-projection-splice-revive-resolve-mdx-renderresolved (resolve_mdx intentionally not revived in CorpusService) |
| AC-8 | 82 | Closeout oracle T3 evidence: merged-main full suite 2139 vitest + 556 bun pass; bun build pass; T1 tsc pass. Test counts vary across worktrees (2046/2057/2115/2139) but final merged state green. Not independently re-run here. | task-t3-text-projection-splice-revive-resolve-mdx-renderresolved (merged-main full suite) |

## Gaps

- AC-2: lore.tree.yaml blueprint file and its tree-check/negative regression tests are absent from the provided diff — only claimed in evidence text, unverifiable.
- AC-7: Implementation directly contradicts the AC — CorpusService.get({resolve_mdx:true}) is deliberately left dead and resolved_components is never populated by the service; resolution moved to adapters. No service-level non-empty test evidenced.
- Round-trip (AC-3), export drift (AC-4), evaluateReadiness unit, and 108-spec regression test bodies are not present in the diff; only summarized in evidence.

## Recommendations

- Include lore.tree.yaml and its armed/negative tests in the change set so AC-2 is verifiable, not just asserted.
- Reconcile AC-7 with the shipped architecture: either revive resolve_mdx in CorpusService.get() as the AC literally requires, or amend the spec/AC to record the approved adapter-layer seam decision and point AC-7's test at the adapter output.
- Surface the actual test files (round-trip, export drift, evaluateReadiness unit, 108-spec validation) in the audited diff to convert evidence claims into verifiable proof.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 60029ms
- Retried: false
- Truncated sections: spec, diff:lore.tree.yaml, diff:packages/core/src/task-workflow.test.ts, diff:packages/lore/tests/integration/cli/check-tree.test.ts, diff:packages/lore/tests/integration/cli/get-mdx-render.test.ts, diff:packages/lore/tests/integration/cli/migrate-spec-kind.test.ts, diff:packages/lore/tests/unit/adapters/cli-create.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-set-kind.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/dashboard-routes.test.ts, diff:packages/lore/tests/unit/adapters/http/routes-resolve-mdx.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-lore-create-ai.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-task-workflow.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/core/schemas.test.ts, diff:packages/lore/tests/unit/eval/fts-recall.test.ts, diff:packages/lore/tests/unit/eval/link-integrity.test.ts, diff:packages/lore/tests/unit/eval/migration-coverage.test.ts, diff:packages/lore/tests/unit/eval/placeholder-parse.test.ts, diff:packages/lore/tests/unit/eval/tree-consistency.test.ts, diff:packages/lore/tests/unit/eval/type-distribution.test.ts, diff:packages/lore/tests/unit/service/corpus-service.test.ts, diff:packages/lore/tests/unit/service/export-docs-collision.test.ts, diff:packages/lore/tests/unit/service/export-docs-service.test.ts, diff:packages/lore/tests/unit/service/outline-render.test.ts, diff:packages/lore/tests/unit/service/spec-kind-service.test.ts, diff:packages/lore/tests/unit/service/task-workflow-service.test.ts, diff:packages/lore/tests/unit/service/tree-blueprint-armed.test.ts
- Reasoning clipped for: AC-7
