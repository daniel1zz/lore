---
id: TASK-1884
type: task
role: plan
title: "[Skill:design] MI-T4 the generated command table in CLAUDE.md lists all 38 package.json scripts verbatim (incl. the retired test:bun stub), duplicating the curated Commands section"
status: archived
priority: medium
phase: "Phase 1: module index"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-239
plan: PLAN-239
---
Estimate: S
Approach: After MI-T2 (2026-10-18) the root CLAUDE.md managed zone carries a command-table section that lists all 38 package.json scripts verbatim — including the retired `test:bun` (an echo + exit 1), the full typecheck chain and every check:* — while the hand-written `## Commands` section already gives the curated commands. The generated table is noise in a tier-1 file and duplicates the curated list. Decide from the governing spec (spec-context-verb-family-two-zone-claude-md-anatomy-lore "Two-Zone File Anatomy": Z1 = module index, command table, governance pointer, spec-discovery pointer) what the command table is FOR, then make it serve that: e.g. list only scripts a project marks as documented, or omit scripts whose body is a retirement stub, or replace it with a pointer — if the spec's Z1 contract must change, that is a new spec (report instead of changing).
Source: MI-T2 review 2026-10-19
AC: the decision is recorded; this repo's root CLAUDE.md carries no retired or duplicate command listing after a refresh.


Addendum 2026-10-19: the coupling is not cosmetic. INT-T9 added a package.json script (check:floor) and AC-MI-3 (refresh --check) went red on main, because the command table copies every script and check:floor (the integrate floor) does not run refresh --check, so a branch that changes package.json lands a stale CLAUDE.md silently (fixed by hand: 58614973). The decision must close this: either the table stops tracking every script, or refresh --check joins the code floor (it depends on tracked files only) — or both. State which and why.
