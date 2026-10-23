---
id: TASK-1783
type: task
role: plan
title: "[Skill:fix] Seat list judges merged against a literal 'main' while seat remove uses the checked-out base branch"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (found by DC2-2, 2026-10-19): `SeatService.remove` now judges "merged" against the branch the main checkout has checked out, but `SeatService.list` still compares each seat against the literal branch name "main" (BR-380). On a repository whose trunk is not called main, `lore seat list` reports every seat's merge status wrongly (or fails), and list and remove disagree about the same seat.
Approach: list and remove use one base-branch derivation (the `mainCheckoutBranch` helper DC2-2 added); a detached main checkout reports the merge column as not measured, never guessed. Modify BR-380 accordingly.
AC: throwaway repo whose trunk is `trunk`: a seat merged into trunk lists as merged and `lore seat remove` removes it without force; with the main checkout detached, list shows the merge state as not measured (exit 0). Runner-produced red.
