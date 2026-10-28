---
id: PLAN-264
type: plan
role: plan
title: "Plan: judge-visible structured fields declared per document type (#414)"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: [governance-mechanism-fixes, issue-414]
parent: SPEC-247
phases:
  - {name: "P1 Red", description: "v8 fixtures captured before any edit; failing tests for AC-JV-1..5"}
  - {name: "P2 Classification", description: "judge-visible-fields.ts in core: total content/state classification per type"}
  - {name: "P3 Prompt v9 and wiring", description: "Shared declared-field renderer, v9 registry entry, active version"}
  - {name: "P4 Close", description: "lore verify, rule apply, anchors"}
---
# Plan — judge-visible structured fields declared per document type (#414)

Implements `spec-each-document-type-declares-which-structured-fields-the` (AC-JV-1..8). Rules: BR-1425 (proposed), BR-261 (modified). Issues: #414 (this plan; closed after the narrow v8 fix, the generalized mechanism is resolved here) and #408 (merged in per user decision D20, carried by the pre-check removal task). Batched S2 draft.

## Ordering

Third of six (the #408 plan was merged in). Written as task-level links (#464): plan 418's close blocks this plan's red task; this plan's v9 task blocks both mirror-export-and-judge tasks of the #416 and #409 plans (they add derived bundle parts that v9 renders). The BR-960 fold task waits for plan-defect-clusters-round-2-part-b's open tasks.

## Overview

A total classification of every type's extra keys lives in @lore/core. Prompt v9 renders every content field with the cap-and-count rule and names unclassified keys. v8 stays byte-frozen.

## Invariants

| # | Invariant | Checked by |
|---|---|---|
| I1 | Every schema key classified exactly once | AC-JV-1 |
| I2 | v1-v8 byte-identical | AC-JV-4 (fixtures captured in P1, before any template edit) |
| I3 | Nothing structured is dropped silently | AC-JV-3 |
| I4 | @lore/core barrel stays browser-safe (judge-visible-fields.ts imports no Node builtin) | barrel-isolation.test.ts in the scoped floor |

## Phases

- **P1 Red**: v8 fixtures captured from the current builder; failing tests for AC-JV-1..5.
- **P2 Classification**: remove the evidence pre-check (#408) and record the legacy set once; migrate plan legacy keys away; judge-visible-fields.ts in core.
- **P3 Prompt v9 and wiring**: the shared renderer, the registry entry, and the active version.
- **P4 Close**: the BR-960 fold (after the round-2 change set lands); lore verify, rule apply.

## Decisions log

D1-D6 in the spec. BR-269/BR-960 are not modified (refused: held by an unlanded change set); BR-1425 is added, and the fold is a task of this plan, so the plan cannot close before it.
