---
id: KN-761
type: knowledge
role: knowledge
title: "Assessment: Defect clusters round 1 (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-233
links:
  - {id: PLAN-233, type: informs}
---
# Assessment: partially_met (76/100)

Scope: plan `01M5966C211HQ2WRE6ADAZ3DJY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DCL-1 | 72 | There is a runner-attested full pass (9/9). Eight separate -t expected-fail runs match cases (a)-(h), so each case was made red once. However, the failing tails show only build output, not the assertion that failed. No DCL-1 source (task-workflow-service.ts, corpus-service.ts) is in the diff. | task-skill-fix-dcl-1-done-floors-judge-real-runs-on-landed-work ([1]-[8] red per case, [9][12][24] pass) |
| AC-DCL-2 | 86 | The diff shows a shared filter-values.ts used by pending, list, calibration, audit, trace, status and review. All refusals are checked before the corpus opens. The test drives the real CLI on a mkdtemp corpus, covering exit 4, accepted values, the happy path and a static scan. Red run [1] bypassed … | task-skill-fix-dcl-2-filter-values-validated-by-one-shared ([1] red, [2][4] attested pass) |
| AC-DCL-3 | 70 | An attested 36/36 pass was rerun in a separate verify-dcl worktree. Red runs [1] and [12] show the phase-rename and static-scan failures. None of the changes to the nine services or the CorpusService extension appear in the diff, so the routing claim and transaction atomicity cannot be checked. | task-skill-fix-dcl-3-every-corpus-write-goes-through-one-write ([1][12] red, [2][10][13] pass) |
| AC-DCL-4 | 74 | Three attested passes (78/78) include an independent verify-dcl run. Red run [1] shows the cd-chain matcher assertion failing. The parser and site changes are not in the diff. The check:hook-shell-cwd run [5] was expected-fail and has no later recorded pass. | task-skill-fix-dcl-4-one-cwd-aware-shell-command-parser-used-by ([1] red, [2][6][13] pass; [5] other expected-fail) |

## Gaps

- The check:hook-shell-cwd run is recorded only as expected-fail, with no later pass.

## Recommendations

- Bundle the full merged diff for every task in the plan into the assessment materials.
- Require red-run evidence tails to include the failing assertion, for example by tailing after the build output.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 36892ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-DCL-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| evidence_integrity | 80 | 0.7 | evidence | 96% of evidence is attested. Red-then-green is shown per AC, with independent verify-dcl reruns. Weak points: the DCL-1 red tails are truncated and the DCL-2 red run is self-reported. |
| scope_fidelity | 82 | 0.55 | evidence | The visible diff stays within DCL-2's command files plus a new validator and test. Scope for the other tasks cannot be seen in the diff. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-DCL-4 | The check:hook-shell-cwd run is recorded only as expected-fail, with no later pass. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Bundle the full merged diff for every task in the plan into the assessment materials. | 3 of 4 ACs could only be judged from test outcomes. |
| process | Require red-run evidence tails to include the failing assertion, for example by tailing after the build output. | Truncated tails weaken the red-first proof. |

## Unverifiable Materials

- DCL-1/DCL-3/DCL-4 source diffs: Not included in the diff. The floor logic, the write-path routing and the cwd parser cannot be inspected.
- AC-DCL-1/3/4 test file contents: Not shown, so it cannot be checked whether the tests assert each spec case as stated.
- outcome dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] The expected-fail tails for the per-case runs of packages/lore/tests/integration/done-floors-landed-real-runs.bun.test.ts are cut off during the dist build. They do not show that the case assertion caused the failure. — "packages/lore/tests/integration/done-floors-landed-real-runs.bun.test.ts" not found at commit dbf994e30af003e27fb03084ff2025895f3de1f6

## Rubric Warnings

- Dimension "outcome" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.96
