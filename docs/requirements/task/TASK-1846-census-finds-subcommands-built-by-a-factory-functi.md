---
id: TASK-1846
type: task
role: plan
title: "Census finds subcommands built by a factory function (autonomy regenerable add/rm fail with entry-symbol-missing)"
status: archived
priority: medium
phase: "P1-census"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-230
plan: PLAN-230
links:
  - {id: TASK-1841, type: blocks}
---
lore baseline sites 'autonomy regenerable add' and 'autonomy regenerable rm' fail with census:entry-symbol-missing default.subCommands.regenerable.subCommands.add.run: the subcommands are built by the factory regenerableVerb (autonomy.ts:180), so the census finds no entry symbol. Until fixed these two runnable commands cannot be declared by a leaf, so root coverage can never be complete and the complete-coverage floor cannot be wired. Expected: the census resolves an entry built by a local factory call (or the registry exposes the entry), keys for these commands listed; declare both on baseline-govern-autonomy-thresholds afterwards.
