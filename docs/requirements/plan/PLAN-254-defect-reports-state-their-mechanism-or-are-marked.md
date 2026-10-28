---
id: PLAN-254
type: plan
role: plan
title: "Plan: defect reports state their mechanism or are marked symptom-only (#420)"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-27
tags: [governance-mechanism-fixes, issue-420]
parent: SPEC-249
phases:
  - {name: "P1 Red", description: "Failing tests for AC-MI-1..4"}
  - {name: "P2 Filing and listing", description: "Diagnosis vocabulary, report-issue flags, body parts, label, listing column, counts, filter"}
  - {name: "P3 Diagnose", description: "lore issue diagnose verb"}
  - {name: "P4 Callers and distribution", description: "MCP tool, assess filer, compiled e2e, shipped guidance"}
  - {name: "P5 Close", description: "verify, rule apply"}
---
# Plan — defect reports state their mechanism or are marked symptom-only (#420)

Implements `spec-a-defect-report-states-its-mechanism-or-is-marked-symptom` (AC-MI-1..6). Rules: BR-491, BR-494, BR-1300 (modified); BR-1427, BR-1428 (proposed); new draft leaf `baseline-diagnose-a-defect-report`. Issue: #420 (carried by this plan). Batched S2 draft.

## Ordering

Ordering by task-level links (#464): the #418 plan's close blocks this plan's red task (implementers' writes need identity). It is independent of the #414, #416 and #409 plans.

## Overview

Filing requires a mechanism with an end-state fix, or an explicit symptom-only mark. The diagnosis travels as a GitHub label plus body sections (not the strict field block, which older binaries would refuse to parse). lore issues shows, counts and filters it. lore issue diagnose records or corrects it.

## Invariants

| # | Invariant | Checked by |
|---|---|---|
| I1 | No filing caller sends a report without a diagnosis choice | AC-MI-1, AC-MI-5 |
| I2 | Older lore binaries still parse every issue (field block unchanged) | report-issue-body-contract field-block assertions (unchanged) |
| I3 | A correction never erases the earlier diagnosis | AC-MI-4 |
| I4 | A missing label reads unstated, never mechanism | AC-MI-3 |

## Phases

- **P1 Red**: failing tests for AC-MI-1..4.
- **P2 Filing and listing**: diagnosis vocabulary in core, report-issue flags, body parts, label, listing column, counts and filter.
- **P3 Diagnose**: the lore issue diagnose verb; a fix carrier (create --issue, issue adopt) refused for an undiagnosed issue.
- **P4 Callers and distribution**: assess filer, compiled e2e, shipped guidance text.
- **P5 Close**: verify, rule apply, leaf approval in the bundle.

## Decisions log

D1-D4 in the spec. The dashboard issues page is out of scope (stated in the spec).
