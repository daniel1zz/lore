---
id: TASK-1149
type: task
role: plan
title: "R3b census treats relative non-code asset imports as not unresolved"
status: archived
priority: medium
phase: "P4-Remediate"
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PLAN-176
plan: PLAN-176
links:
  - {id: TASK-1144, type: blocks}
---
False positive of the #94 fix measured on main: baseline-launch-the-dashboard is INCOMPLETE with 2 unresolved imports ../../../dashboard/dist/index.html and .../index-*.css from packages/lore/src/generated/dashboard-assets.ts (asset files, absent until the dashboard is built; they hold no error sites). Fix: a RELATIVE specifier whose extension is not a code extension (.ts .tsx .js .jsx .mjs .cjs .mts .cts) is not recorded as unresolved; bare package specifiers unchanged. RED test first. Estimate: S
