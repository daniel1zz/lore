---
id: TASK-716
type: task
role: plan
title: "lore territory's discovery set is claim-derived, so an unclaimed local branch is dropped rather than filed unowned"
status: archived
priority: medium
phase: "remediation"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
Machine-checked 2026-08-13 against the module's own stated invariant (territory-partition.ts:39, :49): the discovered entry set is the union of worktree paths and claim-named branches. A local branch that no session claimed and that no worktree has checked out is in NEITHER, so it lands in no bucket at all.

AC-OWN-1 says 'every worktree and branch corpus-wide' and 'NEVER dropped'. The sum-equals-total assertion still passes because the total is defined by the same claim-derived set the partition is built from - the check cannot fail by construction.

That unclaimed branch is precisely the case merge cleanup cares about: it is the one a reader would delete. Enumerate local refs (git for-each-ref) so an unclaimed branch is reported 'unowned', and add an oracle case for a branch nobody ever claimed.
