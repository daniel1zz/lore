---
id: TASK-689
type: task
role: plan
title: "The foreign-write guard: intent is a claim-lease fact, and three cells prove it two-sided"
status: draft
priority: medium
phase: "guard"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-128
plan: PLAN-128
---
Lands D5's core. The service-layer predicate refuses a write whose resolved corpus carries git_common_dir provenance unless intent was declared -- and intent is read from the task's OWN claim lease (taskClaimSchema.worktree, task-workflow.ts:597), never from argv, because --worktree exists on lore claim and on NO other lifecycle verb. Refusals exit EXACTLY 4 carrying the literal token gate:corpus-write:foreign-provenance. AC-CP-3's cell 1 second half -- lore evidence with no flag at all, permitted by lease inheritance -- is what reddens a guard that reads argv instead of the lease. BLOCKED on the pure resolver and the config sub-predicate.
