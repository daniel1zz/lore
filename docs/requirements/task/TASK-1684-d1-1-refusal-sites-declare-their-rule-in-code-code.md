---
id: TASK-1684
type: task
role: plan
title: "D1-1: refusal sites declare their rule in code; code-only census; conversion lands with it"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PLAN-222
plan: PLAN-222
links:
  - {id: TASK-1747, type: blocks}
  - {id: TASK-1673, type: blocks}
---
Implements plan step 1 in full: declarations (LoreError.rule; one rule-taking validationError and storeError helper in @lore/core replacing all 16 local copies; @lore-site tag reader), conflict and retired/unknown-id reporting, deletion of every site_map reference in product source, and the throwaway scratchpad conversion (a)-(f) run on this branch before landing so the converted declarations land with the readers. The directory anchor packages/lore/src/ holds only touched files. After landing the main agent removes the corpus extra.site_map keys in one pass and runs AC-RIC-6.
