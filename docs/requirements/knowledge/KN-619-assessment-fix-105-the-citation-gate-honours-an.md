---
id: KN-619
type: knowledge
role: knowledge
title: "Assessment: Fix #105: the citation gate honours an active exemption on an uncited criterion (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-175
links:
  - {id: PLAN-175, type: informs}
---
# Assessment: partially_met (70/100)

Scope: plan `01M4HR7D39Y2ZSQMK73SP7CSHJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-19 | 88 | Bun test 5/5 pass, and expected-fail evidence shows it was red on main first. Pure-decision tests in cite-gate.test.ts cover exempt+uncited admit, retired-cite refuse, no would-refuse in report mode and expires_at==now. Gaps: the retired case accepts VALIDATION_ERROR; the RED assertion was reworded. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence 1,3,4), 01M4HR7Z9T21QXSB6X78QCJMT2 (RED expected-fail + pass) |
| AC-BLS2-2 | 85 | Verify command re-run after the change: 51/51 pass, including the new exemption block. Adding the required decideCiteGate parameter is covered by the typecheck pass. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence 2, 8) |
| AC-BLS2-3 | 82 | Race test and in-tx test re-run and pass after the change. The diff leaves the in-tx liveness re-check untouched. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence 5) |
| AC-BLS2-10 | 82 | ac-exempt.test.ts 13/13 pass. The 10% cap logic is not touched by the diff. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence 6) |
| AC-BLS2-11 | 80 | Rollback e2e passes. The chokepoint now reads exemptions on every gated write, but it is a read only, so command outputs are unaffected per the passing test. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence 7) |
| AC-BLS2-14 | 65 | Re-measurement: 103/110 = 93.6% with seed 20261012, and the catch-all threshold was computed. But the evidence is ad-hoc python scripts in a tmp scratchpad, fenced rule text is not shown, and gone.py lists a 9th removal (AC-BLS1-4) outside the plan's 8. | 01M4HR7ZNJ0H8NXG1963F5AGM0 (evidence 9,10) |
| AC-BLS2-1 | 20 | No evidence in this plan. Mitigation: outside the #105 fix's practical scope, though the plan declares no ac_scope. | — |
| AC-BLS2-4 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-5 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-6 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-7 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-8 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-9 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-12 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-13 | 20 | No fast-mode assessment record in this plan. Mitigation: outside the #105 scope. | — |
| AC-BLS2-15 | 20 | No evidence in this plan. Mitigation: unrelated to the #105 fix. | — |
| AC-BLS2-16 | 20 | No review-branch assessment record in this plan. Mitigation: outside the #105 scope. | — |
| AC-BLS2-17 | 20 | No evidence in this plan. Mitigation: outside the #105 scope. | — |
| AC-BLS2-18 | 20 | Statement is truncated in the materials and there is no evidence. Mitigation: outside the #105 scope. | — |

## Gaps

- The assertion in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts line 108 changed between the RED evidence (r.ok toBe true) and the implementer's evidence (code-or-ok toBe ok). The task required not touching assertions.
- The retired-cite case in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts accepts VALIDATION_ERROR, so it can pass without the cite gate deciding. The pure test in packages/lore/tests/unit/service/cite-gate.test.ts partially compensates.
- The post-merge removal script output includes AC-BLS1-4, beyond the 8 criteria the plan names. The rationale is not recorded.
- The fidelity re-measurement evidence is produced by ad-hoc python scripts in a tmp scratchpad. Fenced rule text and the per-pair judgments are not shown.

## Recommendations

- Declare extra.ac_scope on single-issue fix plans, listing the target AC and the regression ACs.
- Treat any edit to a RED test's assertions during implementation as a recorded deviation, with a reason.
- Persist the AC-BLS2-14 measurement scripts and inputs in the corpus or repo, not in a tmp scratchpad.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 46037ms
- Retried: false
- Truncated sections: spec

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.75 | evidence | Minimal correct change: pure decision gets an exempted set, the chokepoint loads it fail-closed, only the uncited case is waived. Regression ACs and typecheck green. |
| evidence_integrity | 68 | 0.6 | evidence | Real red-then-green trail with attested runs. Weakened by the reworded RED assertion, the loose error-code match, and tmp-scratchpad python evidence for AC-BLS2-14. |
| scope_fidelity | 72 | 0.55 | evidence | Code diff matches the plan exactly, but post-merge cleanup removed a 9th cite (AC-BLS1-4) not in the plan's list of 8. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-BLS2-19 | The assertion in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts line 108 changed between the RED evidence (r.ok toBe true) and the implementer's evidence (code-or-ok toBe ok). The task required not touching assertions. |
| outcome | minor | AC-BLS2-19 | The retired-cite case in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts accepts VALIDATION_ERROR, so it can pass without the cite gate deciding. The pure test in packages/lore/tests/unit/service/cite-gate.test.ts partially compensates. |
| scope_fidelity | minor | AC-BLS2-14 | The post-merge removal script output includes AC-BLS1-4, beyond the 8 criteria the plan names. The rationale is not recorded. |
| evidence_integrity | minor | AC-BLS2-14 | The fidelity re-measurement evidence is produced by ad-hoc python scripts in a tmp scratchpad. Fenced rule text and the per-pair judgments are not shown. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Declare extra.ac_scope on single-issue fix plans, listing the target AC and the regression ACs. | Without it, unrelated spec ACs are scored as unevidenced and the verdict is capped. |
| process | Treat any edit to a RED test's assertions during implementation as a recorded deviation, with a reason. | Keeps the red-then-green proof trustworthy. |
| process | Persist the AC-BLS2-14 measurement scripts and inputs in the corpus or repo, not in a tmp scratchpad. | Makes the AI-rubric evidence reproducible. |

## Unverifiable Materials

- AC-BLS2-19 statement text: Not included in the spec AC table shown; it is truncated after AC-BLS2-18.
- BR-959 / BR-257 rule documents: Rule creation and narrowing are not in the diff or evidence.
- Exemptions granted for the 8 criteria: No record shows active exemptions preceded the cite removals.
- AC-BLS2-14 judge inputs (fenced rule text, per-pair verdicts): Only the summary line from recount.py is shown.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 19 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 4 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.83
