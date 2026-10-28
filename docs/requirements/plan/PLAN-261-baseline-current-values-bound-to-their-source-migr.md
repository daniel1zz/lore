---
id: PLAN-261
type: plan
role: plan
title: "Plan: baseline current values bound to their source, migrated in one approved batch (#409)"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: [governance-mechanism-fixes, issue-409]
parent: SPEC-251
phases:
  - {name: "P1 Red", description: "Failing tests for AC-CV-1..6"}
  - {name: "P2 Registry and binding", description: "governed-values.ts, createApp telemetry decision, value add and rm, rendering on lore get"}
  - {name: "P3 Refusal, integrity, export and judge", description: "Write refusal of prose sections, unbound finding, export and v9 derived part"}
  - {name: "P4 Retired drafts (deprecated, no work)", description: "Inventory and import verbs"}
  - {name: "P5 Corpus migration and close", description: "Mapping for this corpus, staged revisions, human approval, AC-CV-7, rule apply"}
---
# Plan — baseline current values bound to their source (#409)

Implements `spec-baseline-current-values-are-bound-to-their-source-and` (AC-CV-1..6). Rules: BR-1430, BR-1431, BR-1432 (proposed) on the new draft leaf `baseline-bind-a-current-value-to-its-source`. Issue: #409 (owned and carried by this plan; the evaluation telemetry task no longer resolves it). Batched S2/S3 draft; one-batch migration per user decision D18.

## Ordering (task-level links; plan-level links are ignored by readiness, #464)

Last governance plan. The #416 plan's close blocks this plan's red task. #416's change-batch task blocks this plan's red task and its migration task. #416's refusal task blocks this plan's prose-refusal task (both edit corpus-service.ts). The #414 plan's v9 task blocks this plan's export-and-judge task. Cross-initiative: plan-evaluation-1's envelope task blocks the registry task (both edit app.ts), and its telemetry task blocks the prose-refusal task (it edits rule text and behaviour only, and this plan owns the Current values table, which the refusal then forbids).

## Overview

A governed-value registry in @lore/core is the one definition the product decides with and the baseline renders from. Leaves store bindings only. lore get, export and judge render the value in effect from bindings only; a node with no bindings shows no current values. The change batch validates every binding against the registry at stage and approve. Prose current-values sections are refused at write. A throwaway script (transform, mapping and run; nothing migration-specific ships) migrates the 91 tables AND #416's 20 written children lists in ONE change batch, which a person approves once. Before approval readers see the old text only; after it, only generated parts.

## Invariants

| # | Invariant | Checked by |
|---|---|---|
| I1 | No stored current value: bindings only | AC-CV-1 |
| I2 | Decision site and rendering share one definition | AC-CV-2 |
| I3 | No row of the 91 tables is lost silently | the throwaway script exits 1 on any unaccounted row; its one-time self-check is evidence on the migration task |
| I4 | One human approval; no unreviewed machine write; never two values | #416 AC-CL-4; the migration task's one-time self-checks |
| I5 | No unknown binding can be stored, alone or through a batch | AC-CV-4, AC-CV-6 |
| I5 | @lore/core barrel stays browser-safe (governed-values.ts imports no Node builtin) | barrel-isolation.test.ts in the scoped floor |

## Phases

- **P1 Red**: failing tests for AC-CV-1..6.
- **P2 Registry and binding**: governed-values.ts; createApp telemetry decision through it; value add/rm; rendering on lore get.
- **P3 Refusal, integrity, export and judge**.
- **P5 Corpus migration and close**: the throwaway script stages ONE batch for both generated parts; a person approves once; end-state checks; the script is deleted; verify, rule apply.

## Decisions log

D1-D6 in the spec. The repo mapping lives only in the throwaway script, so the reviewer sees it as part of the one diff set; every drop carries a reason. S2's inventory/import task was deprecated (draft, never claimed) after review finding design-4. The rows the import prints as wrong today are reported to the user as found defects, one line each, alongside the staged revisions.
