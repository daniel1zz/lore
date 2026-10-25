---
id: TASK-1878
type: task
role: plan
title: "[Skill:design] MI-T5 the module-index count line makes every folder add/remove rewrite root CLAUDE.md, so concurrent branches conflict on it — keep 'nothing filtered silently' without a volatile number"
status: draft
priority: medium
phase: "Phase 1: module index"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-239
plan: PLAN-239
---
Estimate: S
Approach: AC-MI-1 requires the module index to end with a count line ("N folders have no memory file and are not listed"). With check:memory-files in the integrate floor (MI-T4), EVERY branch that adds or removes any folder must regenerate and commit root CLAUDE.md (observed 2026-10-19: TG-52 added packages/dashboard/tests/integration/ -> 201 -> 202, floor failed, fixed by hand 18d1e940). Two concurrent branches that each add a folder both rewrite the same line, so the second integrate hits a conflict (exit 4) on CLAUDE.md for no semantic reason — friction proportional to concurrency, against the North Star. The count's purpose (nothing filtered silently) can be met without a volatile number in a tracked memory file: e.g. the line states the filter and points to where the count is measured (lore context refresh output / lore status), or the count is coarse and only changes when a folder gains/loses a memory file. Decide; AC-MI-1 text asserts "one line naming the count 40", so changing it is a spec change — draft the new AC text and BR-882 wording for the orchestrator (do not edit the spec yourself).
Source: TG-52 integrate floor failure 2026-10-19
AC: proposal with measured trade-off; no code change before the spec change is approved.
