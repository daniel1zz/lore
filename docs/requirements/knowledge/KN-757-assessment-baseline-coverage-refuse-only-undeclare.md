---
id: KN-757
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
| AC-BCG-1 | 88 | Two attested passes of the exact verify command, red-first proof against b17a49f1, and a mutation run. The diff test covers exits 0, 1 and 2. Its exit-2 case seeds the value with --non-business, which T2 removes; a later pass in the T2 verify run implies the test was updated, but that version is no… | task-coverage-exits-1-only-for-undeclared-commands-the-floor ([1],[3],[4],[9]), task-a-site-map-takes-br-n-values-only-completeness-guards-and ([12]) |
| AC-BCG-2 | 90 | Attested passes with red-first and mutation evidence. A corrupt-value ordering bug was caught and fixed: --commands-only now returns before the exit-2 check, as the diff shows. The census-recorder stub and the check script are omitted from the diff. | task-coverage-exits-1-only-for-undeclared-commands-the-floor ([2],[6],[7],[8],[10]) |
| AC-BCG-3 | 75 | One attested pass (9 tests) and a red-first run. Neither the test file nor the write-path source is in the diff or the truncation manifest, so the BR-655 exit-4 and version-count assertions cannot be checked. | task-a-site-map-takes-br-n-values-only-completeness-guards-and ([1],[3],[19]) |
| AC-BCG-4 | 55 | Ground-truth coverage shows 0 passes for the exact verify command; the recorded pass used the command without the echo suffix. The test in the diff checks one call per changed leaf, byte-identical BR-n entries, approval kept and an idempotent second run, and it passed 4/4 after a red-first run. | task-strip-and-count-scripts-for-site-map-excuse-entries ([1],[2]) |
| AC-BCG-5 | 80 | Attested pass: residual lines 0. The diff shown still imports from owned-by.ts in leaf-coverage.ts and still uses NON_BUSINESS_PREFIX, so the final removal commit is not shown. The pass is accepted on the attested grep alone. | task-a-site-map-takes-br-n-values-only-completeness-guards-and ([16],[20]) |
| AC-BCG-6 | 75 | Attested pass (5 tests) and a red-first run. Neither the test file nor the guard-removal source is visible, so the BR-1316/BR-1317 exit-4 behaviour that should be kept cannot be checked. | task-a-site-map-takes-br-n-values-only-completeness-guards-and ([2],[4],[21]) |
| AC-BCG-7 | 85 | Attested run against the real corpus: 0 non-BR values, 1356 BR-n values. The count script is omitted from the diff, so its read-only nature cannot be inspected, though the T3 test checks its exit codes. | task-strip-excuses-from-the-corpus-retire-criteria-on-retired ([1]) |

## Gaps

- The diff shown still imports NON_BUSINESS_PREFIX from ./owned-by.js in packages/lore/src/service/leaf-coverage.ts. The deletion of owned-by.ts is not visible; only the attested grep supports it.
- No evidence for P2's lore verify, lore rule apply, retiring criteria on other specs, the replan, or closing the drafts.

## Recommendations

- Record the AC-BCG-4 verify command verbatim with ac_ref so coverage counts the pass.
- Add evidence entries for lore verify and lore rule apply to the P2 task.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 31760ms
- Retried: false
- Truncated sections: diff:scripts/count-site-map-excuses.ts, diff:scripts/lib/baseline-site-maps.ts, diff:scripts/strip-site-map-excuses.ts, diff:packages/lore/tests/unit/service/leaf-coverage-owned-by.test.ts, diff:packages/lore/tests/unit/service/leaf-coverage-site-map-values.test.ts, diff:packages/lore/tests/unit/service/removing-a-site-mapping-is-refused-while-main-still.test.ts, diff:packages/lore/tests/unit/service/site-census.test.ts, diff:scripts/check-baseline-coverage.ts, diff:scripts/tests/check-baseline-coverage-commands-only.test.ts, diff:scripts/tests/check-baseline-coverage-ledger.test.ts, diff:scripts/tests/check-baseline-coverage-render.test.ts, diff:scripts/tests/check-baseline-coverage-tail.test.ts, diff:scripts/tests/helpers/census-recorder-preload.ts, diff:scripts/check-baseline-coverage.ts, diff:scripts/tests/check-baseline-coverage-commands-only.test.ts
- Reasoning clipped for: AC-BCG-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.6 | evidence | The core floor and report behaviour is visible and tested. The write-path and removal code are unseen but backed by attested passes. The P2 corpus follow-ups are unevidenced. |
| evidence_integrity | 78 | 0.65 | evidence | Strong red-first and mutation discipline, and 0.92 attested. But AC-BCG-4's pass does not match its exact command, and some test files are missing from the bundle. |
| scope_fidelity | 85 | 0.6 | evidence | Changes match T1–T3. Deleting the AC-BCR-2/3 tests and rewriting coverage tests follows from the spec's report-only change. No unexplained drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-BCG-5 | The diff shown still imports NON_BUSINESS_PREFIX from ./owned-by.js in packages/lore/src/service/leaf-coverage.ts. The deletion of owned-by.ts is not visible; only the attested grep supports it. |
| outcome | minor | — | No evidence for P2's lore verify, lore rule apply, retiring criteria on other specs, the replan, or closing the drafts. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Record the AC-BCG-4 verify command verbatim with ac_ref so coverage counts the pass. | Ground truth shows 0 passes for AC-BCG-4. |
| plan | Add evidence entries for lore verify and lore rule apply to the P2 task. | These P2 steps have no recorded evidence. |

## Unverifiable Materials

- site-map-rules-only.test.ts, site-map-removal-unguarded.test.ts, and the rule-service write-path source: Not in the diff or the truncation manifest.
- scripts/strip-site-map-excuses.ts, scripts/count-site-map-excuses.ts, scripts/check-baseline-coverage.ts: Omitted from the diff.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] No pass of AC-BCG-4's exact verify command exists; scripts/tests/strip-site-map-excuses.test.ts passed under a command without the echo suffix. — "scripts/tests/strip-site-map-excuses.test.ts" not found at commit e5989a273181ac1f438288c319dc715d852db16f

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.92
