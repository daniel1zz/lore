---
id: TASK-2015
type: task
role: plan
title: "I1 inject/agents replace audience/mode/delivery; hook:user-prompt outlet in every switch; shipped fragments and fixtures re-keyed"
status: archived
priority: medium
phase: "I"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-274
plan: PLAN-274
links:
  - {id: TASK-2016, type: blocks}
  - {id: TASK-2017, type: blocks}
  - {id: TASK-2018, type: blocks}
---
Covers: AC-IT-1, AC-IT-2, AC-IT-3, AC-IT-7, AC-IT-8, AC-IT-9, AC-IT-10, AC-IT-11. Spec sections: Injection timings, Frontmatter (retired keys declared and refused with the migrate hint), Migration mapping (shipped and project set rows), hook:user-prompt outlet (outlet id, layers, legal per-list disables, override refusal in the render, shipped_user_prompt finding, cap, render answer incl. '{}' for an empty selection and HOOK_EVENT_NAMES in commands/fragments.ts; NOT the hook file or its registration), Other consumers re-keyed. Rewrite assets/context/*.md AND this repo's .lore/context/*.md frontmatter by hand per the mapping (these are git-tracked source files in your worktree, not the corpus database); regenerate the assets manifest (bun scripts/embed-assets-manifest.mjs). Move every existing test fixture to inject in the same change and keep each existing criterion's property (rewrite fixtures, do not delete assertions) except those listed for supersession in the plan.
