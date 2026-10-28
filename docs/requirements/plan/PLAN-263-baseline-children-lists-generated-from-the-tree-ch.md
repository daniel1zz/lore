---
id: PLAN-263
type: plan
role: plan
title: "Plan: baseline children lists generated from the tree; change batch (#416)"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: [governance-mechanism-fixes, issue-416]
parent: SPEC-250
phases:
  - {name: "P1 Red", description: "Failing tests for AC-CL-1..4"}
  - {name: "P2 Rendering", description: "lore get text and json, mirror export, v9 judge derived part"}
  - {name: "P3 Refusal and change batch", description: "Baseline integrity comparison, migrate verb, template and root guide"}
  - {name: "P4 Close", description: "Stage the corpus revisions, human approval, verify AC-CL-5, rule apply"}
---
# Plan — baseline children lists generated from the tree; change batch (#416)

Implements `spec-a-baseline-parent-s-children-list-is-rendered-from-the` (AC-CL-1..5). Rules: BR-1429 (amended), BR-1463, BR-1464 (proposed). Issue: #416 (carried by this plan). Batched S2/S3 draft; batch approval per user decision D18.

## Ordering (task-level links; plan-level links are ignored by readiness, #464)

The #414 plan's v9 task blocks this plan's export-and-judge task (the derived bundle part). This plan's change-batch task blocks the #409 plan's red task and its migration task: one shared batch migrates both generated parts. The #409 plan's migration task blocks this plan's render task (user decision D18): rendering lands only after the batch removing every written list is approved, so readers see the old text before and the generated list after, never both.

## Overview

baseline-generated-parts.ts is the one rendering home for a baseline node's generated parts: children here, current values in #409. Rendering covers lore get, export and judge, and is unconditional; the ordering above replaces a transitional mode. A written children list on a parent is refused at write. A change batch stages one diff set and applies it all-or-nothing on one human approval.

## Invariants

| # | Invariant | Checked by |
|---|---|---|
| I1 | No parent can store a children list | AC-CL-3 |
| I2 | A reader never sees a written and a generated list together | task order: the migration batch is approved before the rendering lands; AC-CL-5 |
| I3 | A batch applies all or nothing, and only on approval | AC-CL-4 |
| I4 | Every surface shows the same generated list | AC-CL-1, AC-CL-2 |

## Phases

- **P1 Red**: failing tests for AC-CL-1..5.
- **P2 Rendering**: lore get, export, judge bundle part (after the #409 plan's migration batch is approved).
- **P3 Refusal and change batch**: write refusal, template text, the change batch.
- **P4 Close**: verify, rule apply. This corpus migrates in the #409 plan's single batch.

## Decisions log

D1-D6 in the spec. S2's comparison-check and migrate-verb tasks were deprecated (draft, never claimed) after review findings design-2 and design-4.
