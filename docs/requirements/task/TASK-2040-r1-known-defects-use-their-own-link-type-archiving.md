---
id: TASK-2040
type: task
role: plan
title: "R1 known defects use their own link type; archiving never closes them"
status: archived
priority: medium
phase: "R"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-270
plan: PLAN-270
---
Resolves #404.

The review batch links a covering issue to its plan with link type `resolves`; the archive cascade closes every issue a plan resolves, so 'accepted with known defects' closes its own defects ("Fixed by plan <plan> (archived ...)"), 45 times on 2026-10-24.

- A known defect gets its own link type (e.g. `known-defect`: plan → issue carrier). The batch and `lore assess --file-issues` write it; they never write `resolves`.
- Plan-close coverage (P13's single predicate `coverageOfFailedDimensions`) reads `known-defect` links only.
- The archive cascade keeps closing only `resolves` targets (real fixes stay as they are).
- Migration: every existing plan→issue `resolves` link whose issue carrier holds `extra.milestone_findings` for that plan becomes a `known-defect` link, in the same migration (no reader handles both shapes).
- Q1's "closed cover → re-review" keeps working with the new link type.

Tests: archiving a plan accepted with known defects closes no issue (fake gh records no close call) and its issues stay linked as known defects; a task that `resolves` an issue still closes it on archive; migration converts only batch links (a hand `resolves` link without milestone_findings is untouched).
