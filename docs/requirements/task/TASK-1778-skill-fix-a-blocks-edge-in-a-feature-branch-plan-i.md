---
id: TASK-1778
type: task
role: plan
title: "[Skill:fix] A blocks edge in a feature-branch plan is met when the blocker landed on the plan's integration branch"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (observed 2026-10-19 on plan-github-owns-issue-report-state): the plan lands through one feature branch (gs-integration) and only reaches main at the end. A `blocks` edge counts as met only when the blocker is archived, and `lore done` refuses until the blocker's branch is an ancestor of main (DCL-1 unmerged-branch floor). So every downstream GS task reads blocked until the final landing, although its blocker's code is already on the feature branch it will be built on. The orchestrator worked around it by deleting the T2→T1 and T7→T1 blocks edges, which erases true dependency facts from the corpus — a gate gap.
Approach: a plan may declare an integration branch (extra.integration_branch); a blocker counts as met for readiness and claim when its recorded landing/claim branch head is an ancestor of that integration branch, and `lore done` on such a plan judges "landed" against main only at the plan's final landing (all members archive together then). Readiness labels the state honestly ("met on gs-integration, not on main").
AC: in a throwaway repo, plan P with integration branch I; task A's branch merged into I, not main: B (blocked by A) is READY with the label naming I; `lore done A` still refuses (unmerged into main); after I merges into main, `lore done A` and `lore done B` exit 0. Runner-produced red. Restore the deleted edges T2→T1, T7→T1 once this lands.
