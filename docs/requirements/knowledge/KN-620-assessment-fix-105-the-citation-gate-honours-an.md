---
id: KN-620
type: knowledge
role: knowledge
title: "Assessment: Fix #105: the citation gate honours an active exemption on an uncited criterion (2026-10-10)"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-175
links:
  - {id: PLAN-175, type: informs}
---
# Assessment: partially_met (62/100)

Scope: plan `01M4HR7D39Y2ZSQMK73SP7CSHJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-19 | 85 | RED evidence (expected-fail) then pass (5/5) recorded; diff waives only uncited for active (doc_id, ac_id) exemptions and keeps the expires_at>now rule. The AC statement is cut off in the materials. The retired-cite test also accepts VALIDATION_ERROR, so it is loose. | task-red-ac-bls2-19-test-for-exempted-uncited-criteria-under (expected-fail then pass), task-implement-decidecitegate-admits-an-uncited-criterion (evidence [1],[3],[4]) |
| AC-BLS2-2 | 82 | Regression run: 51/51 cite-gate tests pass after the change. 5 new decideCiteGate exemption tests cover enforce/report/retired. The diff does not show whether existing 4-arg callers were updated. | task-implement-decidecitegate-admits-an-uncited-criterion (evidence [2]) |
| AC-BLS2-3 | 80 | The race test and the in-tx liveness test are still green after the change. The in-tx require_live_rules path is untouched by the diff. | task-implement-decidecitegate-admits-an-uncited-criterion (evidence [5]) |
| AC-BLS2-10 | 80 | The ac-exempt suite passes 13/13 after the change. The 10% cap, the main mitigation against exemptions becoming a blanket escape, still holds. | task-implement-decidecitegate-admits-an-uncited-criterion (evidence [6]) |
| AC-BLS2-11 | 72 | The rollback e2e passes. However, admitAcWrite now reads exemptions before decideCiteGate's mode-off skip, so under mode off a failed exemption read could surface an error. That case is not tested. | task-implement-decidecitegate-admits-an-uncited-criterion (evidence [7]) |
| AC-BLS2-14 | 68 | A recount script reports 103/110 = 93.6% faithful, seed 20261012, max 4 cites per rule vs a 15.25 catch-all threshold. The script and data are in an ephemeral /tmp scratchpad, and there is no proof that rule text was fenced or that the 8 cites were removed first. | task-implement-decidecitegate-admits-an-uncited-criterion (evidence [9]) |
| AC-BLS2-1 | 20 | Outside this fix's goal. The diff touches the chokepoint, but no AC-BLS2-1 run was recorded after the change. | — |
| AC-BLS2-4 | 15 | Outside this plan's goal and not touched by the diff. No evidence. | — |
| AC-BLS2-5 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-6 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-7 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-8 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-9 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-12 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-13 | 20 | This fix enables the cite removals that AC-BLS2-13 item 4 allows, but there is no fast-mode assessment record and no recorded list of the removed cites. | — |
| AC-BLS2-15 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-16 | 15 | Outside this plan's goal. No evidence. Item (4) 'cited or exempted' is consistent with this fix. | — |
| AC-BLS2-17 | 15 | Outside this plan's goal. No evidence. | — |
| AC-BLS2-18 | 15 | Outside this plan's goal. The statement is truncated and there is no evidence. | — |

## Gaps

- The RED evidence shows line 108 as expect(r.ok).toBe(true), but the merged packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts has expect(r.ok ? "ok" : r.error.code).toBe("ok"). The test assertion was edited after RED, against the implement task's instruction.
- admitAcWrite in packages/lore/src/service/ac-write-chokepoint.ts calls store.listAcExemptions() before decideCiteGate returns skip for mode off or for unchanged criteria. So a failed exemption read can now refuse writes that the gate should not affect, and every write reads the full table.
- The AC-BLS2-14 pass comes from a recount.py in an ephemeral /tmp scratchpad. Nothing evidences that the 8 unfaithful cites were removed (plan task 3) or that rule text was fenced for the judge.
- decideCiteGate in packages/lore/src/service/ac-cite-gate.ts gained a required parameter. The typecheck evidence has no visible output, and the diff does not show the existing 4-arg test call sites being updated.

## Recommendations

- Declare extra.ac_scope (AC-BLS2-19 plus the regression set 2/3/10/11/14) on narrow fix plans.
- Require the orchestrator's post-merge steps (cite removals, lore verify) to be recorded as attested evidence with ids and versions.
- Keep fidelity-recount scripts and data in a repo-tracked or knowledge-attached location, not /tmp.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 47947ms
- Retried: false
- Truncated sections: spec

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.7 | evidence | The core fix is correct and narrow: it waives only uncited criteria for active, scoped exemptions, and the regression ACs are green. The cite removals in task 3 are not evidenced. |
| evidence_integrity | 70 | 0.6 | evidence | RED→GREEN is recorded, but the assertion text changed between them. The AC-BLS2-14 run used a tmp script, and the typecheck output is not shown. |
| scope_fidelity | 85 | 0.75 | evidence | The diff is limited to the gate, the chokepoint and the tests. There is no unexplained drift, apart from a small change to a test assertion. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-BLS2-19 | The RED evidence shows line 108 as expect(r.ok).toBe(true), but the merged packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts has expect(r.ok ? "ok" : r.error.code).toBe("ok"). The test assertion was edited after RED, against the implement task's instruction. |
| outcome | minor | AC-BLS2-11 | admitAcWrite in packages/lore/src/service/ac-write-chokepoint.ts calls store.listAcExemptions() before decideCiteGate returns skip for mode off or for unchanged criteria. So a failed exemption read can now refuse writes that the gate should not affect, and every write reads the full table. |
| evidence_integrity | major | AC-BLS2-14 | The AC-BLS2-14 pass comes from a recount.py in an ephemeral /tmp scratchpad. Nothing evidences that the 8 unfaithful cites were removed (plan task 3) or that rule text was fenced for the judge. |
| evidence_integrity | minor | — | decideCiteGate in packages/lore/src/service/ac-cite-gate.ts gained a required parameter. The typecheck evidence has no visible output, and the diff does not show the existing 4-arg test call sites being updated. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Declare extra.ac_scope (AC-BLS2-19 plus the regression set 2/3/10/11/14) on narrow fix plans. | Without a scope, ACs outside the fix are scored as unmet and the verdict drops. |
| process | Require the orchestrator's post-merge steps (cite removals, lore verify) to be recorded as attested evidence with ids and versions. | Without that record, the plan's task 3 cannot be verified. |
| process | Keep fidelity-recount scripts and data in a repo-tracked or knowledge-attached location, not /tmp. | Makes the AC-BLS2-14 evidence reproducible. |

## Unverifiable Materials

- Full AC-BLS2-19 statement: The spec AC table in the materials ends partway through AC-BLS2-18.
- Typecheck output and the full list of decideCiteGate call sites: The output tail is not shown and the diff only shows the chokepoint caller.
- Records of removing the 8 cites and the lore verify output: Neither task has evidence for these.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 19 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.82
