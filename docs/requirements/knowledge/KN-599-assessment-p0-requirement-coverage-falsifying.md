---
id: KN-599
type: knowledge
role: knowledge
title: "Assessment: P0 requirement coverage: falsifying criteria for 8 rules (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-166
links:
  - {id: PLAN-166, type: informs}
---
# Assessment: partially_met (73/100)

Scope: plan `01M4K347DB71K2N6KKBS34TFF0`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-P0C-1 | 88 | The test drives the compiled CLI with a stub gh that records the body. It asserts the field block comes first, then the description/expected/actual/repro order, the number and URL in both JSON and human output, and exit 0. Three named mutations failed as expected. The pass tail is cut off but shows… | task-test-br-494-report-issue-filed-body-contract (evidence [1]-[3] expected-fail, [4] pass) |
| AC-P0C-2 | 42 | The AC needs whitespace-only labels refused on both write paths and an unknown tree refused. The test drops whitespace labels on CorpusService.create and unknown tree on RuleService.addNode because the code accepts them. The pass is green only because those cases were left out, and the echo 'refuse… | task-test-br-613-and-br-623-baseline-node-and-rule-field-bounds (evidence [3] expected-fail, [4] pass with 12 tests; reason comments in the test admit the gaps) |
| AC-P0C-3 | 90 | Covers 500/501 statement and 300/301 example bounds, the confidence and enforcement value sets, and that a refusal consumes no registry id (the next id is +1 and the version is unchanged). The max(500)->max(501) and max(300)->max(301) mutations both failed as expected. Strong boundary falsification. | task-test-br-613-and-br-623-baseline-node-and-rule-field-bounds (evidence [1],[2] expected-fail, [5] pass with 18 tests) |
| AC-P0C-4 | 90 | Covers non-spec target, expiry equal to now and in the past, empty/whitespace/missing grantor, a cap of 1 at 15 criteria, and no version or audit row written. Four distinct mutations failed as expected. It passed in a worktree and in the main tree. | task-test-br-971-exemption-grant-refusals (evidence [1]-[4] expected-fail, [5],[6] pass) |
| AC-P0C-5 | 85 | Asserts the 'none' state, '0 evidence', the 3/2/2/1 counts, and Approve/Reject in the review queue on a zero-evidence doc. Runner-recorded is checked through the '2 attested' label, which is an acceptable mapping. One mutation (none->pass) was evidenced; the counts and queue cases had no named fals… | task-test-br-991-and-br-994-dashboard-evidence-summary-and (evidence [1] expected-fail, [4] pass) |
| AC-P0C-6 | 85 | Schema-skew and error rows are checked for aria-disabled=true and their own exact diagnosis. The all-missing launch resolves with 0 mounted entries and no createApp call. Mutations on both halves failed as expected, though the mount-registry line is approximate (~190). The combined command passed. | task-test-br-991-and-br-994-dashboard-evidence-summary-and (evidence [2],[3] expected-fail, [5] pass) |
| AC-P0C-7 | 60 | Relies on an existing spec that is not in the diff. Evidence [4] shows the approve+edit case failing at isolation.spec.ts:91, and later runs pass with no change or explanation, so it may be flaky. The test title says '404-class', so an exact 404 is unverifiable. Tails cut off before test 4 and the … | task-test-br-996-dashboard-project-scoped-writes-and-br-995 (evidence [4] fail, [5],[7] pass) |
| AC-P0C-8 | 85 | Enumerates exports, with a stale-table guard, and checks the project prefix and plain path for 11 write functions. The DocDetail project-scoped edit sends the project and version, and the If-Match header is asserted. Two mutations failed as expected. The AC was re-baselined mid-run (the e2e half mo… | task-test-br-996-dashboard-project-scoped-writes-and-br-995 (evidence [1],[2] expected-fail, [6] inconclusive old command, [8] pass with 45 tests) |
| AC-P0C-9 | 76 | Checks a stale If-Match 409 with the doc unchanged on project-b and the 409 on the launch project, and the same audit actor on both. The If-Match mutation failed as expected. The tail shows only 2 of 3 tests. The file header still cites AC-P0C-8. BR-996's 'same browser source' is admitted unmet and… | task-test-br-996-dashboard-project-scoped-writes-and-br-995 (evidence [3] expected-fail, [9] pass) |

## Gaps

- baseline-field-bounds.test.ts leaves out whitespace-only labels on CorpusService.create and unknown tree on RuleService.addNode because the code accepts them. The AC requires both refused, so the PASS hides a rule violation.
- Evidence [4] shows multi-project-isolation.spec.ts failing (approveRes.ok() false at line 91). Later passes record no cause, and the spec is not in the diff, so an exact-404 assertion cannot be verified.
- multi-project-write-parity.spec.ts says it does not assert BR-996's browser source (unmet in code) and still cites AC-P0C-8 after the re-baseline.

## Recommendations

- When a falsifier test finds that the code violates the rule, record a fail result against the AC and link a filed issue instead of narrowing the test until it passes.
- Rewrite the AC-P0C-2 and BR-996 statements to match what is actually verified, or keep them failing until the code is fixed.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 48957ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-P0C-1, AC-P0C-2, AC-P0C-5, AC-P0C-7, AC-P0C-8, AC-P0C-9

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.7 | evidence | Most ACs are well falsified. AC-P0C-2 passes by omitting cases the code violates. AC-P0C-7 depends on an unseen, previously failing spec. |
| evidence_integrity | 66 | 0.65 | evidence | Many named mutation runs failed as expected, but only 47% of evidence is attested. Tails are truncated, the AC-P0C-7 fail is unexplained, and the AC-P0C-2 PASS echo overstates coverage. |
| scope_fidelity | 85 | 0.75 | evidence | The diff is test-only and the files are named per the ACs. The AC-P0C-8/9 re-baseline is explained, but quietly narrowing the AC-P0C-2 and BR-996 scope inside test comments is drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-P0C-2 | baseline-field-bounds.test.ts leaves out whitespace-only labels on CorpusService.create and unknown tree on RuleService.addNode because the code accepts them. The AC requires both refused, so the PASS hides a rule violation. |
| evidence_integrity | major | AC-P0C-7 | Evidence [4] shows multi-project-isolation.spec.ts failing (approveRes.ok() false at line 91). Later passes record no cause, and the spec is not in the diff, so an exact-404 assertion cannot be verified. |
| scope_fidelity | minor | AC-P0C-9 | multi-project-write-parity.spec.ts says it does not assert BR-996's browser source (unmet in code) and still cites AC-P0C-8 after the re-baseline. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | When a falsifier test finds that the code violates the rule, record a fail result against the AC and link a filed issue instead of narrowing the test until it passes. | AC-P0C-2 reports PASS while the rule it guards is violated. |
| spec | Rewrite the AC-P0C-2 and BR-996 statements to match what is actually verified, or keep them failing until the code is fixed. | The statements and the asserted scope diverge. |

## Unverifiable Materials

- packages/dashboard/tests/e2e/multi-project-isolation.spec.ts contents: This existing spec is not in the diff, so the exact 404 / ok:false assertions and the cause of the earlier failure cannot be checked.
- Filed issues for the BR-613/BR-996 violations and the verify-tool re-baseline: The issues are claimed but no issue doc or link is provided.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 9 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.47
