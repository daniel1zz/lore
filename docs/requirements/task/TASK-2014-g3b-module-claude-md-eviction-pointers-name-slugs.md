---
id: TASK-2014
type: task
role: plan
title: "G3b module CLAUDE.md eviction pointers name slugs that exist"
status: archived
priority: medium
phase: "G"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-211
plan: PLAN-211
---
G3 pointed the evicted detail at slugs longer than lore's 64-char slug limit, so they could never resolve. The 5 knowledge docs were created with their real (truncated) slugs; the two CLAUDE.md files now name those. Oracle: every knowledge-evicted-* reference in both files resolves with lore get.
