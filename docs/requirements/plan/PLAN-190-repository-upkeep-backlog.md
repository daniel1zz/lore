---
id: PLAN-190
type: plan
role: plan
title: "Repository upkeep backlog"
status: deprecated
priority: medium
created: 2026-10-16
updated: 2026-10-23
tags: []
parent: SPEC-192
phases:
  - {name: "Phase 1: red main"}
  - {name: "Phase 2: corpus and mirror data"}
  - {name: "Phase 3: repo docs"}
  - {name: "Phase 4: repo config, dev env, test infra"}
---
## Overview
Backlog plan owning the 29 upkeep reports adopted on 2026-10-16 (see the spec's Scope for the grouping). DRAFT on purpose: tasks are decomposed per phase when this plan is picked up (lore-plan replan), then it goes through review/approve as usual.

## Invariants
- INV-1: no item here is closed as fixed without the AC it moves (AC-UPK-1..3) re-run on main.
- INV-2: an item that turns out to be a lore product defect is re-filed as ONE defect report and removed from this plan.

## Decisions Log
- D1 (user, 2026-10-16): upkeep reports are adopted by this plan instead of staying in the defect channel (BR-1153).
