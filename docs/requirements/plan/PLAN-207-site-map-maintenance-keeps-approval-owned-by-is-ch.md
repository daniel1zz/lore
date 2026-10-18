---
id: PLAN-207
type: plan
role: plan
title: "Site-map maintenance keeps approval; owned-by is checked"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-199
phases:
  - {name: "P1-implement", description: "Red-first task for AC-SMM-1..3, merged and verified on main"}
links:
  - {id: PLAN-206, type: blocks}
---
# Plan: Site-map maintenance keeps approval; owned-by is checked

Parent: spec-site-map-maintenance-keeps-a-leaf-s-approval-an-owned-by (AC-SMM-1..3; decision adr-mapping-a-census-site-does-not-demote-a-baseline-leaf-an). Blocks plan-baseline-completeness-restoration-every-verb-declared-0 P1 (owner choice 2026-10-18: change the mechanism before mapping).

## Phases
- P1 implement: one red-first task covering AC-SMM-1..3 in a worktree (tests written red and recorded expected-fail, then implementation), merged to main, `lore verify` on main, `bun run build`.
- Close: `lore rule apply` lands BR-654/658/660 modifications (plan close), `lore assess`.

## Invariants
- No change to any other demotion path (rule add/set/move, glossary, depends, set-label, content).
- Census and coverage stay read-only.
- Never write the repo's own .lore/ from tests.
