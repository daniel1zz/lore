---
id: KN-623
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
# Assessment: partially_met (52/100)

Scope: plan `01M4HR7D39Y2ZSQMK73SP7CSHJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-19 | 85 | The test was recorded red on main and green after the fix (3 attested passes). The diff covers the active, expired, absent, other-criterion and retired-cite cases, plus unit tests for report mode and expiry == now. The retired-cite test accepts either of two error codes, which is loose. | task-red-ac-bls2-19-test-for-exempted-uncited-criteria-under (expected-fail then pass), task-implement-decidecitegate-admits-an-uncited-criterion (pass x2 + expected-fail) |
| AC-BLS2-2 | 80 | cite-gate.test.ts passed after the change: 51 tests, 1 attested. The diff adds exemption cases, including report mode with no would-refuse finding. The plan required this AC to stay green and the evidence shows it did. | task-implement-decidecitegate-admits-an-uncited-criterion (evidence [2]) |
| AC-BLS2-3 | 25 | The plan names this AC as an invariant that must stay green, but no run was recorded after the change. The in-transaction liveness path looks untouched in the diff, but that cannot be confirmed. | — |
| AC-BLS2-10 | 25 | Invariant AC with no rerun recorded. The diff does not touch the exemption grant or cap logic, so a regression is unlikely but unproven. | — |
| AC-BLS2-11 | 25 | Invariant AC with no rerun recorded. Mode off still returns skip before the new code runs, but in that mode admitAcWrite may now read exemptions, which matters if store IO is observable. Unverified. | — |
| AC-BLS2-1 | 15 | Outside this fix's goal, but no ac_scope was declared, so it is in scope. No evidence. The chokepoint was edited. | — |
| AC-BLS2-4 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-5 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-6 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-7 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-8 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-9 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-12 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-13 | 15 | No assessment record. Removing judged-unfaithful cites (plan task 3) is allowed after measurement, but that work is not evidenced. | — |
| AC-BLS2-14 | 15 | Plan task 3 says to re-run AC-BLS2-14 with a new seed after removing the 8 cites. There is no record of the re-run or of the removals. | — |
| AC-BLS2-15 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-16 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-17 | 15 | Outside the fix's goal. No evidence. | — |
| AC-BLS2-18 | 15 | Outside the fix's goal. No evidence. | — |

## Gaps

- The plan requires AC-BLS2-3, AC-BLS2-10 and AC-BLS2-11 to stay green, but no post-change runs are recorded, even though packages/lore/src/service/ac-write-chokepoint.ts changed.
- decideCiteGate in packages/lore/src/service/ac-cite-gate.ts gained a required exemptedAcIds parameter. A caller passing undefined would throw on an uncited candidate, and the typecheck in the task oracle is not evidenced.
- Plan task 3 has no evidence: removing the 8 judged-unfaithful cites under enforce and re-running AC-BLS2-14 with a new seed.
- The first assertion in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts changed between the RED evidence and the final diff, despite the instruction not to touch assertions. The new form is equivalent but more diagnostic.
- The retired-cite case in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts accepts either AC_CITE_REQUIRED or VALIDATION_ERROR. A refusal for an unrelated reason could therefore pass.

## Recommendations

- Declare extra.ac_scope on fix plans: the target AC plus the invariant ACs.
- Require attested reruns of every invariant AC the plan names, plus a typecheck, before archiving the implement task.
- Record orchestrator post-merge steps (verify, cite removals, AC-BLS2-14 re-run) as evidence on a task.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 42085ms
- Retried: false
- Truncated sections: spec

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 70 | 0.6 | evidence | The core fix is implemented and tested; the exemption waives only 'uncited'. The cite removals and AC-BLS2-14 re-run are not delivered, and the invariant ACs were not re-proven. |
| evidence_integrity | 65 | 0.6 | evidence | RED-then-GREEN trail exists with attested runs. 1 of 3 records per task self-reported. No typecheck or invariant-AC reruns. Assertion changed after RED. |
| scope_fidelity | 75 | 0.6 | evidence | The diff is confined to the gate, the chokepoint and their tests, as the plan intends. The test assertion was edited despite the 'don't touch' instruction, and no ac_scope was declared. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS2-3 | The plan requires AC-BLS2-3, AC-BLS2-10 and AC-BLS2-11 to stay green, but no post-change runs are recorded, even though packages/lore/src/service/ac-write-chokepoint.ts changed. |
| evidence_integrity | major | — | decideCiteGate in packages/lore/src/service/ac-cite-gate.ts gained a required exemptedAcIds parameter. A caller passing undefined would throw on an uncited candidate, and the typecheck in the task oracle is not evidenced. |
| outcome | major | AC-BLS2-14 | Plan task 3 has no evidence: removing the 8 judged-unfaithful cites under enforce and re-running AC-BLS2-14 with a new seed. |
| scope_fidelity | minor | AC-BLS2-19 | The first assertion in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts changed between the RED evidence and the final diff, despite the instruction not to touch assertions. The new form is equivalent but more diagnostic. |
| outcome | minor | AC-BLS2-19 | The retired-cite case in packages/lore/tests/unit/service/cite-gate-exemption.bun.test.ts accepts either AC_CITE_REQUIRED or VALIDATION_ERROR. A refusal for an unrelated reason could therefore pass. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Declare extra.ac_scope on fix plans: the target AC plus the invariant ACs. | Without it, every spec AC is in scope and the score is diluted by unrelated ACs. |
| process | Require attested reruns of every invariant AC the plan names, plus a typecheck, before archiving the implement task. | Invariants were asserted but not proven. |
| process | Record orchestrator post-merge steps (verify, cite removals, AC-BLS2-14 re-run) as evidence on a task. | Task 3 currently leaves no trail. |

## Unverifiable Materials

- Other callers of decideCiteGate and typecheck output: Only the chokepoint call site appears in the diff.
- BR-959 / BR-257 corpus changes: The rule docs are not in the materials.
- Post-merge cite removals and AC-BLS2-14 re-run: No evidence records.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 19 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.67
