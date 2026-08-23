---
id: TASK-791
type: task
role: plan
title: "[Skill:test] regression guard — a GitHub close cannot yield a corpus fixed resolution"
status: archived
priority: high
phase: "P0: Runner + error taxonomy"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-775, type: blocks}
---
Estimate: S
Source: AC-GI-13 of the governing spec; Risk Registry R6; the ADR's rejected-alternative analysis
TDD-Role: regression guard — STANDALONE BY DESIGN, no paired implementation task (Decisions Log D-4)
Dimensions: D-FUNC

This task locks in EXISTING `computeIssueResolution` behaviour before any code moves. There is nothing to implement: the guard must be green on unmodified HEAD and must stay green through P1-P5. A red here at any later phase means a regression, which is exactly its purpose.

Scenarios:
- Given an issue record with no explicit resolution state, no resolves edge and no adoption, When a GitHub-side close-as-completed is represented, Then computeIssueResolution still returns `open` — not `fixed`
- Given an issue record whose GitHub representation is closed with state_reason `not_planned`, When computeIssueResolution runs, Then the result is unchanged from the pre-close computation
- Given an issue record with a resolves edge to an archived source doc, When computeIssueResolution runs, Then the result IS `fixed` — proving the guard distinguishes the legitimate path from the GitHub back door rather than rejecting everything

AC:
- All three scenarios exist as executable vitest cases in the anchored file
- The anchored file is GREEN on unmodified HEAD (this is a guard, not a red-first task) — the third scenario is what stops it passing vacuously by rejecting all inputs
- The command and its output tail are recorded as pass evidence against AC-GI-13
