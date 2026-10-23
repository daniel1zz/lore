---
id: TASK-1891
type: task
role: plan
title: "[Skill:fix] INT-T6 after integrate lands, refresh the detached shared checkout to the new main when no uncommitted edit is touched; report kept-dirty"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
links:
  - {id: TASK-1893, type: blocks}
---
Estimate: S
Approach: adr-main-advances-only-by-lore-integrate-per-session (E5/E5b, Installation and migration): after integrate lands, the detached shared checkout is moved to the new main with `git checkout --detach main` only when that refresh cannot touch an uncommitted edit (git refuses with "would be overwritten" -> leave it, report it, nothing lost). INT-T2 (merged) detaches the view but never refreshes it, so the shared view stays at the commit of the first integrate. Implement the refresh after a successful CAS (and after an already-integrated no-op), reporting refreshed / kept-dirty <paths> / not-measured in integrate's output and --json.
Red-first: land a branch -> today the shared checkout HEAD stays at the old main (red); after: equals new main. Control: a shared checkout with an edit that conflicts with the landed change -> kept, edit byte-identical, reported.
Source: INT-T2 report 2026-10-18
AC: both halves green; AC-INT-1/2 oracles pass.
