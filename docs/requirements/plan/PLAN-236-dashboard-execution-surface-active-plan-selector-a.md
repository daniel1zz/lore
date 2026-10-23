---
id: PLAN-236
type: plan
role: plan
title: "Dashboard execution surface: active-plan selector and honest ready-list badges"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-077
phases:
  - {name: "P1"}
---
## Overview

Two defects in the execution read surface, found on 2026-10-19 by opening the packaged dashboard (`lore dashboard`) against this repo's corpus with a headless browser. Governing spec: spec-077-dashboard-execution-read-surface-prd-21-f3 (approved). Both make the code do what the approved spec already says; the spec's text and ACs are unchanged.

1. The plan selector (`ExecutionPage.tsx:82`) queries plans with `status=active`. In this corpus no plan is `active` (875 approved, 464 draft), so the selector shows "No active plans" and the execution page cannot be reached from the UI. SPEC-077 S1 says the selector "lists active plans (existing bootstrap/list read surface)", and bootstrap defines an active plan as one that is neither archived nor deprecated (`session-service.ts`, bootstrap loop). The home Active Plans panel (`ActivePlansPanel.tsx:87`) runs the same query and is fixed by the same change; this touches only which plans it lists, not the home page's identity (SPEC-077 non-goal).
2. `ReadyTaskList` renders one row per `ReadyReport.records[]` entry, as SPEC-077 S2 and AC-077-1 require, but labels each row only from `ready` (`ReadyTaskList.tsx:125`): an archived task (52 of 58 records for plan-test-governance-…) is labelled "blocked". The label lies about the corpus.

## Phases

- P1: one task covering items 1 and 2.

## Design

- Item 1: one definition of "active plan". The predicate bootstrap uses (not archived, not deprecated) becomes one named function in `@lore/core`; bootstrap and the HTTP list surface (a named list filter, e.g. `active=true` on `GET /api/docs?type=plan`) both call it, and the dashboard's two queries ask for that filter instead of `status=active`. The two surfaces then cannot disagree.
- Item 2: one row per record stays. The row's badge is derived from the task's status first: archived renders "done"; only a non-archived task renders "ready" or "blocked" from `ready`. No filtering, no route contract change.

## Acceptance (observable, red first)

- Against a throwaway corpus with an approved plan holding one archived and one draft task: the execution page's selector lists that plan; the ready list shows two rows, the archived one badged "done" and the draft one "ready"; the home Active Plans panel lists the plan.
- `GET /api/docs?type=plan&active=true` returns exactly the plans `lore bootstrap` lists as active for the same corpus.
