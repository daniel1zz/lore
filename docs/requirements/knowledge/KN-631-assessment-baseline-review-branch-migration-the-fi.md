---
id: KN-631
type: knowledge
role: knowledge
title: "Assessment: Baseline review-branch migration — the first branch eligible to arm the citation gate (2026-10-09)"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-177
links:
  - {id: PLAN-177, type: informs}
---
# Assessment: partially_met (42/100)

Scope: plan `01M4F8763EX7J84TKNGE5C9KCW`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-1 | 5 | No evidence in this bundle. Mitigation: the plan's only exit criterion is AC-BLS2-16, and this script AC (AC write chokepoint) belongs to slice-2 implementation work outside this plan. | — |
| AC-BLS2-2 | 5 | No evidence. Mitigation: this is a cite-gate mechanics AC, not something this migration plan produces. The plan explicitly leaves arming out of scope. | — |
| AC-BLS2-3 | 5 | No evidence. Mitigation: it covers the retire/cite race in the store layer, outside this plan's scope. | — |
| AC-BLS2-4 | 5 | No evidence. Mitigation: migration 14 is an implementation AC that this plan does not own. | — |
| AC-BLS2-5 | 8 | No direct test evidence. Bars 2+3 show `lore baseline coverage` running and exiting 0 on review, which indirectly shows the census works. The fixture test itself is not shown. | task-w1b-apply-the-review-branch-and-reach-0-coverage-gaps |
| AC-BLS2-6 | 5 | No evidence. Mitigation: rule show/find/impact is outside this plan's scope. | — |
| AC-BLS2-7 | 5 | No evidence. Mitigation: the feed cap is outside this plan's scope. | — |
| AC-BLS2-8 | 5 | No evidence. Mitigation: worktree corpus scope is outside this plan, which writes from main. | — |
| AC-BLS2-9 | 5 | No evidence. Mitigation: snapshot parse scope is outside this plan's scope. | — |
| AC-BLS2-10 | 10 | No test evidence. Bar 4 reports 9 exemptions against a cap of 102 (0.9%), consistent with the cap working, but the race test has not been run here. | task-w2-place-and-cite-every-criterion-of-specs-in-the-review |
| AC-BLS2-11 | 5 | No evidence. Mitigation: the rollback byte-identity check is outside this plan's scope. | — |
| AC-BLS2-12 | 5 | No evidence for spec/execution coverage, even though the blind reader depends on those branches. Mitigation: owned by the completeness backfill plan. | — |
| AC-BLS2-13 | 5 | No evidence. Mitigation: this is the fast-mode, all-branches gate, which comes after this plan. | — |
| AC-BLS2-14 | 5 | No evidence. Mitigation: it applies only after all branches are armed, which comes after this plan. | — |
| AC-BLS2-15 | 5 | No evidence. Mitigation: census fidelity is an implementation AC. The plan's risk register claims a guard is already on main but shows no evidence for it. | — |
| AC-BLS2-16 | 55 | Bars 2-4 are evidenced (13/59 rules cited, 0 uncovered, 0.9% exempt). Bar 1 fails on the original 9/10 bar. It passes only on a relative bar set after scoring, equal to the observed 1.0 margin (amendment logged). The bar-5 re-measure is cut off in W8's output; 19/20 predates remediation. | task-w8-re-assess-the-review-branch-against-ac-bls2-16, task-w7-blind-reader-and-separate-grader-on-the-re-probe, task-w5-freeze-the-review-re-probe-before-the-remediation, task-w3b-independent-fidelity-judge-over-every-review-citation, task-w2-place-and-cite-every-criterion-of-specs-in-the-review |
| AC-BLS2-17 | 5 | No evidence. This AC is the needed confirmation of AC-16's provisional post-hoc bar-1 pass and is still pending the fast-mode probe. Until it lands, the review pass stays provisional. | — |
| AC-BLS2-18 | 5 | No evidence. Mitigation: the 9 fast-mode branches are outside this plan's scope. | — |

## Gaps

- Bar 1 passes only under a relative threshold (+1.0 over control) decided after both probes and controls were scored. The +1.0 equals the deciding margin of 7.5 vs 6.5. Under the registered absolute bar of >= 9/10, both attempts failed.
- W8's combined output is truncated before the bar 5 line, so the fidelity result after remediation is not visible. W6 changed rules and cites (53->59 rules), and the rubric requires a re-measure.
- The oracle scripts live in an ephemeral scratchpad (e.g. /private/tmp/claude-501/-Users-apple-Projects-zz-lore/6b85319e-c895-4c9d-84c0-ab5ad4984378/scratchpad/ctl/bar1rel.sh), so neither their logic nor the reader/grader artifacts can be audited.
- The review branch's provisional pass needs AC-BLS2-17's fast-mode confirmation, which has no evidence.

## Recommendations

- Persist oracle scripts plus reader, grader and control transcripts as linked knowledge docs, and record full, untruncated outputs for multi-bar commands.
- Pre-register bar thresholds before any measurement. If a bar is re-baselined after the fact, require independent confirmation, as AC-BLS2-17 does, before arming.
- Add an explicit post-remediation bar 5 record with the judged count, and the W6 first-write timestamp, to the W8 assessment.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 45638ms
- Retried: false
- Truncated sections: plan, spec

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 50 | 0.6 | evidence | Bars 2-4 are evidenced. Bar 1 passes only under a post-hoc bar set exactly at the observed margin. Bar 5's post-remediation value is not visible. The pass is provisional pending AC-17. |
| evidence_integrity | 40 | 0.55 | evidence | Every run is attested, but the scripts are ephemeral and self-written. W8 is truncated before bar 5, W4 has no ac_ref or output, and the control grading cannot be verified. |
| scope_fidelity | 80 | 0.6 | evidence | It stays within the plan: no arming, the stop rule and owner choices are recorded, and there is a single re-probe. The bar change is disclosed as post-hoc in I5. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BLS2-16 | Bar 1 passes only under a relative threshold (+1.0 over control) decided after both probes and controls were scored. The +1.0 equals the deciding margin of 7.5 vs 6.5. Under the registered absolute bar of >= 9/10, both attempts failed. |
| evidence_integrity | major | AC-BLS2-16 | W8's combined output is truncated before the bar 5 line, so the fidelity result after remediation is not visible. W6 changed rules and cites (53->59 rules), and the rubric requires a re-measure. |
| evidence_integrity | minor | AC-BLS2-16 | The oracle scripts live in an ephemeral scratchpad (e.g. /private/tmp/claude-501/-Users-apple-Projects-zz-lore/6b85319e-c895-4c9d-84c0-ab5ad4984378/scratchpad/ctl/bar1rel.sh), so neither their logic nor the reader/grader artifacts can be audited. |
| outcome | minor | AC-BLS2-17 | The review branch's provisional pass needs AC-BLS2-17's fast-mode confirmation, which has no evidence. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Persist oracle scripts plus reader, grader and control transcripts as linked knowledge docs, and record full, untruncated outputs for multi-bar commands. | Self-authored PASS strings from ephemeral scripts cannot be audited. |
| spec | Pre-register bar thresholds before any measurement. If a bar is re-baselined after the fact, require independent confirmation, as AC-BLS2-17 does, before arming. | A threshold equal to the observed margin carries no signal. |
| plan | Add an explicit post-remediation bar 5 record with the judged count, and the W6 first-write timestamp, to the W8 assessment. | Both are required by the AC-16 rubric and are not visible here. |

## Unverifiable Materials

- judge2/bar5.sh output after remediation: W8 output_tail is truncated before the bar 5 line.
- Oracle script contents and reader/grader/control transcripts: Only the PASS/FAIL strings are provided, and the scripts sit in an ephemeral scratchpad.
- W6 first-write timestamp: The W5 check asserts the ordering but does not show the W6 timestamp.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 1

## Facts Summary

- AC coverage: 18 declared criteria
- Task evidence: 11 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=1.00
