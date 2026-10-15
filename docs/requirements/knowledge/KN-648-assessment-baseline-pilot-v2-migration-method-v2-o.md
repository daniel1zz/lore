---
id: KN-648
type: knowledge
role: knowledge
title: "Assessment: Baseline pilot v2: migration method v2 on the specification branch (2026-10-08)"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-173
links:
  - {id: PLAN-173, type: informs}
---
# Assessment: not_met (24/100)

Scope: plan `01M4CKMN4M384ANH3J4PPMJKWQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS1-1 | 5 | No evidence in this bundle (0 pass, 0 fail). Mitigation: this is a slice-1 implementation AC. This measurement-only plan makes no source changes, so it was never expected to run this AC. It is unmet here, not contradicted. | — |
| AC-BLS1-2 | 5 | No evidence (0/0). Mitigation: this is a slice-1 code AC outside this pilot plan's work, and the plan has no diff. Unverifiable from these materials. | — |
| AC-BLS1-3 | 5 | No evidence (0/0). Mitigation: this is a slice-1 code AC. The plan does no code work, so it did not exercise this AC. | — |
| AC-BLS1-4 | 5 | No evidence (0/0). Mitigation: this is a slice-1 code AC outside this plan's tasks. | — |
| AC-BLS1-5 | 5 | No evidence (0/0). Mitigation: this is a slice-1 code AC outside this plan's tasks. | — |
| AC-BLS1-6 | 5 | No evidence (0/0). V1c uses `lore ac cite` operationally, but that is not a test run of this AC. Mitigation: this is a slice-1 code AC. | — |
| AC-BLS1-7 | 5 | No evidence (0/0). Mitigation: this is a slice-1 code AC outside this plan's tasks. | — |
| AC-BLS1-8 | 5 | No evidence (0/0). Mitigation: this is a slice-1 code AC outside this plan's tasks. | — |
| AC-BLS1-9 | 5 | No evidence (0/0). Mitigation: this is a slice-1 code AC outside this plan's tasks. | — |
| AC-BLS1-11 | 10 | This is the v1 pilot exit. The plan says v1 failed both kill lines, which is why plan v2 exists. There is no evidence in this bundle, and the context says it failed. Mitigation: AC-BLS1-12 replaces it as the measured exit. | — |
| AC-BLS1-12 | 12 | Attested FAIL. The blind score was 4.5/10 against a bar of 9. Bars 1, 2, 3 and 5 are evidenced as met: sample of 70 with seed 20261008 and hash frozen, coarse disagreement within 30%, 0 uncited rules, 0 confident-wrong. The fail was measured and recorded honestly, and no bar was moved. | task-v3-pilot-v2-assessment-against-ac-bls1-12-and-slice-2 (attested fail, 4.5/10), task-v2b-blind-reader-on-probe-set-v2, task-v2a-two-independent-mappers-adjudication-on-ac-sample-v2, task-v1c-citation-coverage-pass-every-established-observed-rule, task-v0b-freeze-ac-sample-v2-seeded-60-acs-specs-outside-v1 |

## Gaps

- The blind reader primary score is 4.5/10 against a bar of 9/10. The attested V3 evidence records this as a FAIL, so the pilot v2 exit is not met.
- The V2a kill-line check collapses labels to BR-id/GAP/OUT before counting disagreements. Disagreements between specific placements may be undercounted relative to the AC wording.
- The V0a ordering check (newest baseline write before probe creation) holds only at the time it ran. No durable check ties the probe timestamp to the first plan-v2 baseline version.
- Exclusion of the v1 specs from the AC sample is self-reported (manual oracle), with no attested check.

## Recommendations

- Set extra.ac_scope to [AC-BLS1-12] for measurement-only pilot plans.
- Escalate the v2 FAIL to the owner, and stop the baseline migration method per the pre-registered one-retry rule.
- Specify the disagreement granularity, either rule id or class, in AC-BLS1-12-style bars.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 39897ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 25 | 0.85 | evidence | All phases ran and 4 of 5 bars were met, but the exit AC-BLS1-12 failed: blind score 4.5/10. The spec's other ACs have no evidence here. |
| evidence_integrity | 72 | 0.7 | evidence | Checks are mostly attested with mutation tests and frozen hashes. Weak points: V2a scores coarse disagreement only, V0a ordering is point-in-time, and the sample-population check is manual. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | blocker | AC-BLS1-12 | The blind reader primary score is 4.5/10 against a bar of 9/10. The attested V3 evidence records this as a FAIL, so the pilot v2 exit is not met. |
| evidence_integrity | major | AC-BLS1-12 | The V2a kill-line check collapses labels to BR-id/GAP/OUT before counting disagreements. Disagreements between specific placements may be undercounted relative to the AC wording. |
| evidence_integrity | minor | AC-BLS1-12 | The V0a ordering check (newest baseline write before probe creation) holds only at the time it ran. No durable check ties the probe timestamp to the first plan-v2 baseline version. |
| evidence_integrity | minor | AC-BLS1-12 | Exclusion of the v1 specs from the AC sample is self-reported (manual oracle), with no attested check. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Set extra.ac_scope to [AC-BLS1-12] for measurement-only pilot plans. | This avoids scoring code ACs that the plan never intended to touch. |
| process | Escalate the v2 FAIL to the owner, and stop the baseline migration method per the pre-registered one-retry rule. | The plan pre-committed to no v3 within this delegation. |
| spec | Specify the disagreement granularity, either rule id or class, in AC-BLS1-12-style bars. | The bar is ambiguous between the coarse and full-granularity counts. |

## Unverifiable Materials

- v2 pilot assessment doc content: Only grep checks are visible. The downgrade counts and root causes cannot be inspected.
- sample selection script and v1 exclusion list: The evidence is a manual oracle, and the sample.py output is not shown.
- scope_fidelity dimension score: Commit set unverifiable (convention mismatch — plan archived, no commit referenced any task slug). scope_fidelity was NOT SCORED, regardless of what the judge reported.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.94
