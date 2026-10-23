---
id: KN-753
type: knowledge
role: knowledge
title: "Assessment: Baseline coverage: refuse only undeclared commands, strip site-map excuses (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-218
links:
  - {id: PLAN-218, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M5A0KNBV64G4AK2K7W65ARQZ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BCG-1 | 88 | The new report-only test covers all three exits: unmapped sites give 0 with a count, an undeclared command gives 1, a non-BR value gives 2. Red against pre-change main b17a49f1, then green three times, including the verify-p2b worktree. The baseline.ts diff matches. | task-coverage-exits-1-only-for-undeclared-commands-the-floor (evidence [1] red, [4][9][26] pass) |
| AC-BCG-2 | 85 | Red then green, plus a mutation run and a red for the corrupt-value ordering fix. The --commands-only path returns before listSitesMany. The floor script and the census-recorder preload are listed as omitted, so the zero-census-calls claim rests on the tests alone. | task-coverage-exits-1-only-for-undeclared-commands-the-floor (evidence [2][3][7] red, [6][8][27] pass) |
| AC-BCG-3 | 72 | site-map-rules-only went red then green (9 tests) in the verify-p2 worktree. The production diff for the write path (map options, rule-service validation) is not in the diff and not in the truncation manifest, so the code cannot be checked. | task-a-site-map-takes-br-n-values-only-completeness-guards-and (evidence [1] red, [3][19] pass) |
| AC-BCG-4 | 80 | The strip test went red then green twice, and typecheck:scripts passed. The script source is listed as omitted, so idempotence and one-version-per-leaf are taken from the test only. | task-strip-and-count-scripts-for-site-map-excuse-entries (evidence [1] red, [2][4] pass) |
| AC-BCG-5 | 70 | The grep oracle reports 0 residual lines. But the visible diff still has leaf-coverage.ts importing NON_BUSINESS_PREFIX from ./owned-by.js, plus 'non-business' doc comments, and baseline.ts importing NON_BUSINESS_PREFIX. The deletion diff that would remove these is not shown. | task-a-site-map-takes-br-n-values-only-completeness-guards-and (evidence [16][20] residual 0) |
| AC-BCG-6 | 72 | site-map-removal-unguarded went red then green, and the older removal-refused test still passes. The service code that removes the completeness guards is not in the visible diff. | task-a-site-map-takes-br-n-values-only-completeness-guards-and (evidence [2] red, [4][21] pass) |
| AC-BCG-7 | 80 | The read-only count on the real corpus printed 0 non-BR values and 1356 BR-n values. There is a single run, and count-site-map-excuses.ts is omitted, so its matching rule cannot be checked. | task-strip-excuses-from-the-corpus-retire-criteria-on-retired (evidence [1]) |

## Gaps

- The visible diff of packages/lore/src/service/leaf-coverage.ts still imports NON_BUSINESS_PREFIX from ./owned-by.js and keeps comments naming non-business. packages/lore/src/adapters/cli/commands/baseline.ts imports NON_BUSINESS_PREFIX. No deletion diff is shown to reconcile this with the grep result of 0.
- The write-path changes (map rejects non-BR values with exit 4 naming BR-655; the --non-business option is removed) are not in the diff or the truncation manifest. Only test results back them.

## Recommendations

- Make sure the assessment bundle includes every production-source diff, or lists it in the truncation manifest, so that grep-based ACs can be checked against the code.
- Add explicit evidence tasks for lore verify and lore rule apply, and for the attested passes on other specs' criteria that cite changed rules.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 36092ms
- Retried: false
- Truncated sections: diff:scripts/check-baseline-coverage.ts, diff:scripts/tests/check-baseline-coverage-commands-only.test.ts, diff:scripts/tests/check-baseline-coverage-ledger.test.ts, diff:scripts/tests/check-baseline-coverage-render.test.ts, diff:scripts/tests/helpers/census-recorder-preload.ts, diff:scripts/check-baseline-coverage.ts, diff:scripts/tests/check-baseline-coverage-commands-only.test.ts, diff:packages/lore/tests/helpers/seed-site-map-value.ts, diff:scripts/tests/strip-site-map-excuses.test.ts, diff:scripts/count-site-map-excuses.ts, diff:scripts/lib/baseline-site-maps.ts, diff:scripts/strip-site-map-excuses.ts, diff:packages/lore/tests/integration/cli/baseline-coverage.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.6 | evidence | All 7 ACs have attested passes. The T1 code shown is coherent. The T2 code is unseen, and the visible leaf-coverage.ts conflicts with AC-BCG-5. |
| evidence_integrity | 82 | 0.65 | evidence | Red-before-green for each test AC, a mutation run, and re-verification in clean worktrees. AC-BCG-7 is a single run. P2 governance steps have no evidence. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BCG-5 | The visible diff of packages/lore/src/service/leaf-coverage.ts still imports NON_BUSINESS_PREFIX from ./owned-by.js and keeps comments naming non-business. packages/lore/src/adapters/cli/commands/baseline.ts imports NON_BUSINESS_PREFIX. No deletion diff is shown to reconcile this with the grep result of 0. |
| evidence_integrity | major | AC-BCG-3 | The write-path changes (map rejects non-BR values with exit 4 naming BR-655; the --non-business option is removed) are not in the diff or the truncation manifest. Only test results back them. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make sure the assessment bundle includes every production-source diff, or lists it in the truncation manifest, so that grep-based ACs can be checked against the code. | AC-BCG-5 contradicts the code that is visible. |
| plan | Add explicit evidence tasks for lore verify and lore rule apply, and for the attested passes on other specs' criteria that cite changed rules. | The plan names these as a risk, and nothing evidences them. |

## Unverifiable Materials

- T2 production diff (owned-by.ts deletion, rule-service, baseline map args): Not in the diff and not in the truncation manifest.
- scripts/check-baseline-coverage.ts, scripts/strip-site-map-excuses.ts, scripts/count-site-map-excuses.ts: Omitted by the truncation manifest; only test results are visible.
- P2 lore verify / lore rule apply output: No evidence records were provided.
- scope_fidelity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.92
