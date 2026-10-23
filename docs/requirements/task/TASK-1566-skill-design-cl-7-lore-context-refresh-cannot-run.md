---
id: TASK-1566
type: task
role: plan
title: "[Skill:design] CL-7 lore context refresh cannot run on this repo: it would splice a 251-line managed zone into the hand-curated root CLAUDE.md (329 > 220 ceiling)"
status: archived
priority: medium
phase: "Phase 1: cleanup without a human"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-205
plan: PLAN-205
---
Estimate: M
Approach: CL-5 found: the root CLAUDE.md (78 lines) has no lore:managed zone, only legacy auto:module-index / auto:dynamic-context markers, so refresh appends a whole managed zone (module index listing every directory incl. docs/, tests/, scripts/ with 'no memory file yet', plus the command table) = 329 lines; the ceiling refusal is correct. Consequence: rules files can only be re-rendered via rulesOnly scripts. Decide: migrate CLAUDE.md to the two-zone layout within the ceiling, or filter module-index discovery to directories with memory files. Candidate dump: scratchpad cl5/candidate.md.
Source: CL-5 report 2026-10-18
AC: lore context refresh exits 0 on this repo with CLAUDE.md within its ceiling.
