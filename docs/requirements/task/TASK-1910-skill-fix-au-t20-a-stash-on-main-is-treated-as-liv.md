---
id: TASK-1910
type: task
role: plan
title: "[Skill:fix] AU-T20 a stash on main is treated as live whenever ANY open claim exists on main; attribute it to the run whose lifetime and checkout contain it"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: lore stash prune 2026-10-18 escalated 10 stashes created on branch main (score 0.20), all with attribution "branch main has an open task claim with no run to prove it ended: treated as a live run". Any open claim anywhere on main makes every stash ever created on main "live", so stashes from long-ended sessions can never be pruned without the human. The attribution must tie a stash to a specific owner: the run whose lifetime contains the stash commit time and whose working copy is the checkout the stash came from (stash commit parents + reflog time), or else "no provable owner" (B for unattributable objects per ADR D2), never "live" by proxy of an unrelated claim. Red-first: an old stash on main + an unrelated open claim on main -> today escalated as live (red); after: attributed to its ended creator or unattributable. Control: a stash created on main during a live run that still runs -> still kept/escalated.
Source: stash prune --apply 2026-10-18 (pending decisions #55..#76)
AC: both halves green; AC-AU-4 oracle still passes.
