---
id: TASK-1923
type: task
role: plan
title: "Correct the approved criteria that encode the removed behaviour"
status: draft
priority: high
phase: "P2 Migration and foreign-criteria corrections"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1924, type: blocks}
---
Covers: the corpus side of the foreign-criteria list in the spec section 'Approved criteria of other specs that encode the old behaviour'. Kind: corpus (no file changes). Done by the orchestrator in the shared checkout BEFORE the landing of the integration branch, with today's rules (no contract exists yet, so a no-branch claim and `lore done --declare-no-new-tests "corpus corrections, no new test"` still work), after J1 to J3 are done. Rule apply does not read other specs' criteria, so this is about truth, not about unblocking it.
TDD-Role: none
Approach: one audited `lore ac set --correction <reason>` (with `--reason`, `--premise`, `--alt` as for any change to an approved spec) per criterion, keeping its test command: AC-ND-1 and AC-UC-1 (the `lore done --declare-no-new-tests` step becomes `lore approve --red-waiver`), AC-ND-9 (keep the anchored-task refusal; drop the no-branch-claim half), AC-LB-5 (a code task prints the stored contract with red_required true unless `--red-waiver`), AC-DC2-21 (red is the default on the implement task; no `lore red-first`), AC-AP-4 and AC-AP-9 (floor ids `no-contract` and `red-first` from the stored contract; no `no-new-tests`), AC-AP-5 (the stub floor id), AC-ROI-4 (`every clean claim that is not finished`), AC-S3-2, AC-S3-3 and AC-P-3 (`overlapping write sets (default: the task's anchors)`). AC-049-4 and AC-RID-12 are left as recorded. Verification of these specs runs in the plan close (L), at the landed commit.
Done when: each listed criterion reads the new behaviour (`lore ac list` of each spec shows no `--declare-no-new-tests`, no `red_first` declaration and no no-branch claim for them), and the list of corrections is on this task as evidence (`--oracle other`, with the `lore ac list` output captured).
