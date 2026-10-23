---
id: KN-033
type: knowledge
role: knowledge
title: "Assessment: SPEC-038 Implementation — AC-as-code (2026-07-08)"
status: archived
priority: medium
created: 2026-07-08
updated: 2026-10-23
tags: []
parent: PLAN-018
links:
  - {id: PLAN-018, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KWZRW2XZ3CDEKX118JDMJ1Z8`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ACODE-1 | 90 | acceptance.ts fully shown: id regex ^AC-[A-Z0-9]+(-[A-Z0-9]+)*$, statement max 2000, script/ai/human discriminated union (script requires command). specAcceptanceCriteriaSchema rejects dup ids via superRefine. T1 evidence: 29 new acceptance.test.ts pass. Test file present but unseen. | task-t1-core-acceptance-schema-oracle-kinds-ssot-ac-ref (134 files/2721 tests incl 29 acceptance tests) |
| AC-ACODE-2 | 84 | specExtraSchema += acceptance_criteria.optional() shown; corpus-service imports schema for validation. AcService (write orchestration) omitted, so create/set roundtrip not directly visible. T3 full suite passes; ac-service.test.ts present but unseen. | task-t3-service-acservice-ac-verbs-resolvedeclaredacids-port (135 files/2777 tests) |
| AC-ACODE-3 | 84 | CLI --ac flag → ac_ref shown; port resolveDeclaredAcIds wired in app.ts and CorpusService; addEvidence validation described but the fn itself is unseen. task-workflow.test.ts present. T2/T3 evidence passes. Exit-4/version-bump behavior relies on unseen service code. | task-t2-adapters-oracle-enum-consolidation-evidence-ac-mcp-ac-re (134 files/2725 tests) |
| AC-ACODE-4 | 90 | assess-template.ts diff fully shows renderStructuredAcTable (id\|statement\|verify\|coverage via computeAcCoverage), ASSESS_PROMPT_VERSION 3→4, and byte-identical verbatim fallback when no structured ACs (conditional branch). T4 evidence passes containment/version-4 suite. | task-t4-assess-structured-ac-prompt-ac-id-containment (134 files/2734 tests) |
| AC-ACODE-5 | 79 | declaredAcIds plumbed from buildAssessPrompt to assessPlan for containment set; validateAcIdContainment itself in omitted ai-provider-service.ts. 'no doc created / retry not consumed' behavior asserted by plan+T4 evidence only, not visible in diff. Conservative on unseen subtlety. | task-t4-assess-structured-ac-prompt-ac-id-containment (containment suite) |
| AC-ACODE-6 | 92 | computeAcCoverage fully shown: pure, per-ac_ref pass/fail aggregation, excludes non-matching/absent ac_ref, empty tasks yields {pass:0,fail:0,refs:[]} per criterion in order, no mutation. Matches AC exactly. T1 tests cover aggregation with/without ac_ref and empty set. | task-t1-core-acceptance-schema-oracle-kinds-ssot-ac-ref (acceptance.test.ts) |
| AC-ACODE-7 | 83 | ac.ts add/list/rm shown incl --force and dangling-ref rendering; rm exit-4-while-referenced logic lives in omitted AcService. Roundtrip + rm-refused STATE test asserted in T3 (present but unseen ac-service.test.ts). Wiring/registration confirmed in loader diff. | task-t3-service-acservice-ac-verbs-resolvedeclaredacids-port (ac verbs + rm --force test) |
| AC-ACODE-8 | 95 | Diff shows ORACLE_KINDS SSOT in task-workflow.ts; evidence.ts deletes local VALID_ORACLES, mcp tools.ts uses z.enum(ORACLE_KINDS). Grep oracle verify (=0 hits) passes per T6 evidence [1] and coverage 1 pass/0 fail. Directly verifiable, highest confidence. | task-t6-verify-dogfood-full-oracles-structured-ac-conversion-doc (grep adapters oracle-enum == 0 pass) |
| AC-ACODE-9 | 85 | outline projection modules omitted, but export-docs-service.test REGRESSION shown asserts body contains '## Acceptance Criteria (structured)' with ✔/· checklist and idempotent second export (raw-untouched claim in plan). T5 evidence passes AC projection suites. | task-t5-projection-ac-checklist-in-get-non-raw-export-docs (134 files/2753 tests) |
| AC-ACODE-10 | 91 | T6 evidence [3] bunx vitest 135 files/2777 pass and [4] bun test 610 tests/38 files 0 fail — both runners full suites post-merge. Coverage 2 pass/0 fail. Directly evidenced by named oracle runs. | task-t6-verify-dogfood-full-oracles-structured-ac-conversion-doc (both runners green) |
| AC-ACODE-11 | 91 | T6 evidence [2] bun run typecheck: 5 sub-checks exit 0 post all merges. Coverage 1 pass/0 fail. Type-level exhaustiveness gate in acceptance.ts adds a real typecheck forcing function. Directly evidenced. | task-t6-verify-dogfood-full-oracles-structured-ac-conversion-doc (typecheck 5 sub-checks exit 0) |

## Gaps

- Dogfood coverage is thin: only AC-8/10/11 carry ac_ref evidence (1/2/1 pass); AC-1..7 and 9 show 0 pass / 0 fail, so the self-hosted conversion did not link evidence for most declared criteria.
- Key service internals are omitted (AcService rm-refused logic, validateAcIdContainment retry-non-consumption, outline projection render) — those ACs rest on aggregate suite evidence, not visible code.
- Every per-AC test file named in the verify column is truncated/unseen; confidence derives from full-suite pass claims plus the visible core/adapter/template diffs.

## Recommendations

- Complete the dogfood: record ac_ref evidence for AC-1..7 and AC-9 so computeAcCoverage reflects real coverage rather than mostly 0/0.
- Surface the omitted service diffs (AcService, ai-provider-service validateAcIdContainment, outline projection) in future audits to directly verify exit-4, retry-non-consumption, and raw-untouched behaviors.
- Consider a negative-path assertion in evidence linking that AC-ACODE-5's rejected judge output leaves no knowledge doc, captured as recorded evidence.

## Judgment

- Provider: claude-cli
- Prompt version: 4
- Duration: 82560ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:docs/requirements/prd/PRD-001-lore-positioning.md, diff:docs/requirements/spec/SPEC-038-spec-038-ac-as-code-structured-acceptance-criteria.md, diff:packages/core/src/acceptance.test.ts, diff:packages/lore/src/service/ac-service.ts, diff:packages/lore/src/service/ai-provider-service.ts, diff:packages/lore/src/service/outline-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/integration/cli/task-workflow.test.ts, diff:packages/lore/tests/unit/adapters/cli-evidence-ac-ref.bun.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-task-workflow.test.ts, diff:packages/lore/tests/unit/service/ac-service.test.ts, diff:packages/lore/tests/unit/service/ai-provider-service-assess.test.ts, diff:packages/lore/tests/unit/service/outline-render.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/task-workflow-service.test.ts
