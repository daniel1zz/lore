---
id: TASK-1811
type: task
role: plan
title: "Citation gate checks every check-decided criterion, not only added or revised ones"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
## Finding

The citation gate checks only criteria a write adds or revises: `changedCriteria` in `packages/lore/src/service/ac-cite-gate.ts:227-239` skips every criterion whose canonical JSON is unchanged, and `decideCiteGate` (`ac-cite-gate.ts:313-319`) returns skip when nothing changed. An untouched older check-decided criterion that cites nothing is therefore never refused, so "every criterion cites a live rule" holds only for criteria written since the gate was armed. The per-criterion exemption (BR-959) expires and is not a permanent non-citing marker. Raised by the review of baseline-product-baseline (design_necessity).

## End state

Every check-decided acceptance criterion either cites at least one live BR/AS rule or carries an explicit, permanent non-citing marker with a reason. Existing uncited criteria are migrated (cited, or marked non-citing with a reason). The gate then evaluates the whole criteria set of a spec on every write, not only changed criteria, so no criterion is grandfathered. Once enforcement covers every criterion on every branch, the per-branch arming state (armed_branches, read by `isBranchArmed` at ac-cite-gate.ts:211-220) is removed or reduced to a single mode, so no phased-rollout state remains.

## Acceptance (red first)

- AC: a test builds a spec with an untouched check-decided criterion that cites nothing and has no non-citing marker, makes an unrelated edit to a sibling criterion under an enforcing branch, and asserts the write is refused with exit 4 naming that criterion. Red today: `changedCriteria` drops the untouched criterion.
- AC: a migration/check reports 0 check-decided criteria in the corpus that neither cite a live rule nor carry a non-citing marker with a non-blank reason.
- Falsifier: restoring the unchanged-JSON skip in `changedCriteria` (as gate input) turns the first AC green-to-red; a non-citing marker with a blank reason must also be refused.
