---
id: KN-488
type: knowledge
role: knowledge
title: "Assessment: Land M7: an adopted state that frees defect-channel quota without retiring the claim, with abandonment counted (2026-08-21)"
status: archived
priority: medium
created: 2026-08-21
updated: 2026-10-23
tags: []
parent: PLAN-132
links:
  - {id: PLAN-132, type: informs}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01M0H49F81WHY5JAQPS038WJA6`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DC-14 | 88 | Attested pass (evidence 9) plus red seeds (1,2,13). Diff shows QUOTA_FREEING_RESOLUTIONS as the declared seam and adopted added to NON_TERMINAL members. Caveat: issue-report-service.ts does NOT import that seam — it hand-checks `live.resolution === "adopted"`, so the set the test compares is not th… | 01M0H4ARTGYFS97M76KTWRCAP6 (evidence 9; e2e 12 confirms unfinished listing) |
| AC-DC-15 | 90 | Attested pass (evidence 10) with prior expected-fails (3,14). checkResolutionPointer centralizes missing/unresolvable/self-reference/wrong-type precedence; refusal happens before any write. Byte-identical `extra` assertion is claimed in the echo, not visible in the omitted test file. | 01M0H4ARTGYFS97M76KTWRCAP6 (evidence 10) |
| AC-DC-16 | 82 | Attested pass (evidence 11) with three distinct red seeds (4,5,6,15). isDanglingAdoption is store-free; count field + --enumerate sibling registered in status.ts. But it implements TWO conjuncts, arguing conjunct 1 subsumes the spec's third — a defensible but unilateral narrowing of the stated cont… | 01M0H4ARTGYFS97M76KTWRCAP6 (evidence 11; status.ts collectAdoptedAbandonedMembers) |
| AC-DC-17 | 90 | Attested e2e pass (evidence 12) after expected-fails (7,8,16). Evidence 8 demonstrates the provenance guard FAILING loudly on a stale binary rather than skipping — exactly the criterion's load-bearing requirement. | 01M0H4ARTGYFS97M76KTWRCAP6 (evidence 7,8,12) |
| AC-DC-9 | 55 | Not in the task's build list but directly at risk: the vocabulary gained a member and issue-report-service.ts adds a second, hand-typed occupancy check. No AC-DC-9 oracle run appears in evidence (0 pass/0 fail), so the repo-wide one-site invariant is unverified post-change. | — |
| AC-DC-1 | 50 | Statement was amended to explicitly EXCLUDE adopted, i.e. M7 changed its contract, yet no re-run is recorded (0 pass/0 fail). The cap narrowing it pins was edited in this diff. | — |
| AC-DC-12 | 60 | Both dashboard switches gained an `adopted` case (IssuesList.tsx, IssueDetail.tsx), which is the required response to widening the union — but the parity oracle itself was not re-run (0 pass/0 fail). | 01M0H4ARTGYFS97M76KTWRCAP6 (diff: dashboard components) |
| AC-DC-2 | 45 | Asserts quota_freeing_states equals TERMINAL_ISSUE_RESOLUTIONS as sets. M7 makes quota-freeing ≠ terminal, so the refusal payload's advertised verbs may now be incomplete. No re-run recorded. | — |
| AC-DC-4 | 60 | Pointer-refusal path was rewritten to route through checkResolutionPointer; the M3 regression is asserted inside the M7 test (evidence 3 tail), but AC-DC-4's own oracle shows 0 pass/0 fail. | 01M0H4ARTGYFS97M76KTWRCAP6 (evidence 3 tail: M3 regression sub-test) |
| AC-DC-3 | 60 | Untouched by this diff; no re-run recorded. Neutral — no evidence of regression, none of health. | — |
| AC-DC-5 | 60 | Untouched; no re-run recorded. | — |
| AC-DC-6 | 60 | Untouched; no re-run recorded. | — |
| AC-DC-7 | 60 | Untouched; no re-run recorded. | — |
| AC-DC-8 | 60 | Untouched; no re-run recorded. | — |
| AC-DC-10 | 60 | Untouched; no re-run recorded. | — |
| AC-DC-11 | 60 | Untouched; no re-run recorded. | — |
| AC-DC-13 | 60 | Untouched; no re-run recorded. | — |

## Gaps

- AC-DC-14(b) requires quota occupancy be decided through ONE seam compared as a set. packages/lore/src/service/issue-resolution.ts declares QUOTA_FREEING_RESOLUTIONS, but packages/lore/src/service/issue-report-service.ts does not import it — it checks TERMINAL_ISSUE_RESOLUTIONS then a separate literal `live.resolution === "adopted"`. Its own comment admits the export 'exists for the test, not consumed here'. The test can therefore pass while production drifts from the seam it validates.
- The plan specifies three conjuncts for abandonment (state adopted AND owner archived/deprecated AND no terminal resolution). isDanglingAdoption in packages/lore/src/service/issue-resolution.ts implements two, arguing conjunct 1 over the COMPUTED resolution subsumes the third. Defensible, but it means no red seed can isolate the third conjunct independently as the AC demands.
- The vocabulary module packages/core/src/issue-resolution-vocab.ts gained a member and both AC-DC-9-named consumers were edited, yet AC-DC-9's oracle shows 0 pass / 0 fail. The added `adopted` sentinel in packages/lore/src/service/issue-report-service.ts is exactly the kind of second hand-typed occurrence that criterion exists to catch.
- AC-DC-2 asserts the cap refusal's quota_freeing_states equals TERMINAL_ISSUE_RESOLUTIONS as sets, but after M7 the states that actually free quota include `adopted`. No re-run is recorded, so the refusal may now advertise an incomplete verb set. AC-DC-1's statement was likewise amended for M7 without a re-run.
- The diff carries AC-BFI-14 work outside the plan's M7 scope: a new isSpecAnchored export in packages/lore/src/flows/drift-flow.ts, its adoption in packages/lore/src/adapters/cli/commands/status.ts, plus scripts/check-anchor-coverage.ts and packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts. Seven unrelated plan/task rows also appear in .lore/export-index.json. None is explained by the plan.

## Recommendations

- Add a follow-up task making issue-report-service.ts consume QUOTA_FREEING_RESOLUTIONS directly, and update AC-DC-14's oracle to assert the imported set is reference-identical to the one production narrows on.
- Reconcile AC-DC-16's three-conjunct text with the two-conjunct isDanglingAdoption that shipped — either restore the third conjunct or restate the criterion over the computed resolution.
- Require re-running every AC whose statement or named consumers were edited by a change set (here AC-DC-1, AC-DC-2, AC-DC-9, AC-DC-12) before archiving the task.
- Keep unrelated refactors (AC-BFI-14's isSpecAnchored collapse) out of an M7 change set, or declare them in the plan as accepted concurrent scope.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 179966ms
- Retried: true
- Truncated sections: spec, task:task-land-the-adopted-resolution-state-its-required-owner, diff:packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts, diff:scripts/check-anchor-coverage.ts, diff:.lore/export-index.json, diff:packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts, diff:packages/lore/tests/unit/service/issue-resolution.test.ts
- Reasoning clipped for: AC-DC-14, AC-DC-16
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.72 | evidence | All four M7 ACs attested pass with red seeds first and a compiled-CLI e2e. Deductions: quota seam not consumed by production, AC-DC-16 shipped 2 of 3 conjuncts. |
| evidence_integrity | 80 | 0.7 | evidence | Genuine red-then-green per AC, incl. a stale-binary failure proving the guard fails rather than skips. Weakened by 0.44 attested ratio and untested tail-adjacent ACs. |
| scope_fidelity | 66 | 0.75 | evidence | M7 work matches the plan closely, but the diff also carries AC-BFI-14 isSpecAnchored refactoring and seven unrelated index rows the plan never declared. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-DC-14 | AC-DC-14(b) requires quota occupancy be decided through ONE seam compared as a set. packages/lore/src/service/issue-resolution.ts declares QUOTA_FREEING_RESOLUTIONS, but packages/lore/src/service/issue-report-service.ts does not import it — it checks TERMINAL_ISSUE_RESOLUTIONS then a separate literal `live.resolution === "adopted"`. Its own comment admits the export 'exists for the test, not consumed here'. The test can therefore pass while production drifts from the seam it validates. |
| outcome | major | AC-DC-16 | The plan specifies three conjuncts for abandonment (state adopted AND owner archived/deprecated AND no terminal resolution). isDanglingAdoption in packages/lore/src/service/issue-resolution.ts implements two, arguing conjunct 1 over the COMPUTED resolution subsumes the third. Defensible, but it means no red seed can isolate the third conjunct independently as the AC demands. |
| evidence_integrity | major | AC-DC-9 | The vocabulary module packages/core/src/issue-resolution-vocab.ts gained a member and both AC-DC-9-named consumers were edited, yet AC-DC-9's oracle shows 0 pass / 0 fail. The added `adopted` sentinel in packages/lore/src/service/issue-report-service.ts is exactly the kind of second hand-typed occurrence that criterion exists to catch. |
| evidence_integrity | minor | AC-DC-2 | AC-DC-2 asserts the cap refusal's quota_freeing_states equals TERMINAL_ISSUE_RESOLUTIONS as sets, but after M7 the states that actually free quota include `adopted`. No re-run is recorded, so the refusal may now advertise an incomplete verb set. AC-DC-1's statement was likewise amended for M7 without a re-run. |
| scope_fidelity | minor | AC-DC-17 | The diff carries AC-BFI-14 work outside the plan's M7 scope: a new isSpecAnchored export in packages/lore/src/flows/drift-flow.ts, its adoption in packages/lore/src/adapters/cli/commands/status.ts, plus scripts/check-anchor-coverage.ts and packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts. Seven unrelated plan/task rows also appear in .lore/export-index.json. None is explained by the plan. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a follow-up task making issue-report-service.ts consume QUOTA_FREEING_RESOLUTIONS directly, and update AC-DC-14's oracle to assert the imported set is reference-identical to the one production narrows on. | As shipped, the AC's set comparison validates an export production ignores, so the seam can drift silently. |
| spec | Reconcile AC-DC-16's three-conjunct text with the two-conjunct isDanglingAdoption that shipped — either restore the third conjunct or restate the criterion over the computed resolution. | The AC's red-seed requirement names three conjuncts; only two are separately falsifiable now. |
| process | Require re-running every AC whose statement or named consumers were edited by a change set (here AC-DC-1, AC-DC-2, AC-DC-9, AC-DC-12) before archiving the task. | Four criteria depending on the edited vocabulary and cap narrowing show 0 pass / 0 fail. |
| plan | Keep unrelated refactors (AC-BFI-14's isSpecAnchored collapse) out of an M7 change set, or declare them in the plan as accepted concurrent scope. | Undeclared drift makes the diff hard to attribute and dilutes M7's evidence trail. |

## Unverifiable Materials

- packages/lore/tests/unit/service/issue-resolution.test.ts: Omitted from the diff; cannot confirm the AC-DC-14 seam comparison is a true set comparison against QUOTA_FREEING_RESOLUTIONS rather than a literal list.
- packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts: Omitted; the provenance-guard exit-0 assertion and unfinished-listing check are visible only via evidence tails.
- Byte-identical `extra` SHA comparison for AC-DC-15 refusals: Claimed in the echo text only; the asserting test file is not shown.
- AC-DC-9 repo-wide uniqueness scan result post-change: No oracle run recorded for AC-DC-9 in this task's evidence.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 10
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 17 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.44
