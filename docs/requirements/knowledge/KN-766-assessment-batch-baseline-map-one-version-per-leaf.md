---
id: KN-766
type: knowledge
role: knowledge
title: "Assessment: Batch baseline map: one version per leaf per mapping round (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-232
links:
  - {id: PLAN-232, type: informs}
---
# Assessment: met (87/100)

Scope: plan `01M595YMVTD637E9DXNJE21RN5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BMB-1 | 88 | The service test covers the full AC: 50 rows give +1 version and 1 baseline-map audit row listing all 50 sites, the leaf stays approved, and 50 single-site calls give +50. The CLI test checks +1 version and 50 sites, but not the audit row or approved status, because the CLI fixture leaf is never ap… | task-baseline-map-sites-file-many-site-mappings-all-or-nothing (evidence [5] AC-BMB-1 pass; [1] red, [2] green) |
| AC-BMB-2 | 85 | The CLI test checks that a foreign rule on row 50 gives exit 4 and VALIDATION_ERROR, and leaves the version and site map unchanged. The service test also checks that the audit trail and approval are unchanged, and that all bad rows are reported. The error names the site key and rule, not 'row 50'. … | task-baseline-map-sites-file-many-site-mappings-all-or-nothing (evidence [6] AC-BMB-2 pass) |
| AC-BMB-3 | 90 | 11 CLI cases cover: not valid JSON, not an array, an empty array, malformed rows, a duplicate key inside the file, a duplicate between the file and --site, and a missing file. Each one asserts exit 4, VALIDATION_ERROR, a message naming the problem, and an unchanged version and site map. A well-form… | task-baseline-map-sites-file-many-site-mappings-all-or-nothing (evidence [7] AC-BMB-3 pass) |

## Gaps

- The CLI fixture leaf in packages/lore/tests/helpers/baseline-map-cli-fixture.ts is never approved. Through the real wiring, the AC-BMB-1 clauses 'stays approved' and '1 audit row' are therefore checked only by the InMemoryStore test in packages/lore/tests/unit/service/site-map-batch-one-version.test.ts.
- The validation in packages/lore/src/service/rule-service.ts names the offending site key and rule but not a row number, so 'naming that row' is met only through the site key.

## Recommendations

- Check approved status and audit row count in the CLI-level AC-BMB-1 test, using a fixture that approves the leaf.
- State whether 'naming that row' means the 1-based row index or the site key.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 28284ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-BMB-1, AC-BMB-2, AC-BMB-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.8 | evidence | The diff adds --sites-file and makes the service check every row before writing. Tests cover all 3 ACs at the service and CLI layers. Approval and audit are checked only at the service layer. |
| evidence_integrity | 86 | 0.75 | evidence | Red then green, regression suites, a tsc pass, and AC-ref script runs all pass. Output tails are truncated but show passes. 1 of 7 evidence records is self-reported. |
| scope_fidelity | 87 | 0.75 | evidence | Changes stay within baseline map and setSiteMap. Reporting every bad row and refusing duplicates between the file and --site go slightly past the ACs but are consistent with them. BR-658 closure is n… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-BMB-1 | The CLI fixture leaf in packages/lore/tests/helpers/baseline-map-cli-fixture.ts is never approved. Through the real wiring, the AC-BMB-1 clauses 'stays approved' and '1 audit row' are therefore checked only by the InMemoryStore test in packages/lore/tests/unit/service/site-map-batch-one-version.test.ts. |
| outcome | minor | AC-BMB-2 | The validation in packages/lore/src/service/rule-service.ts names the offending site key and rule but not a row number, so 'naming that row' is met only through the site key. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Check approved status and audit row count in the CLI-level AC-BMB-1 test, using a fixture that approves the leaf. | This closes the mock-risk gap the test file itself flags for InMemoryStore. |
| spec | State whether 'naming that row' means the 1-based row index or the site key. | The current wording is ambiguous, and the implementation uses only the site key. |

## Unverifiable Materials

- Full output for evidence [1]-[4] and the BR-658 closure: Only truncated tails and commands are shown, and the merge to main and verify run are not visible.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.86
