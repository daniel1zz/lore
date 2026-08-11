---
id: TASK-509
type: task
role: plan
title: "T2 ordinal render at the SSOT projection point (renderHandoffContent) + floor on the feed path"
status: archived
priority: medium
phase: "render"
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PLAN-100
plan: PLAN-100
links:
  - {id: TASK-506, type: blocks}
  - {id: TASK-508, type: blocks}
---
## Objective

Make `renderResumeRecord` emit ordinal-tagged item lines and a cardinality line derived from the structured SSOT, on BOTH the CLI stdout and the MCP `lore_feed` session-resume response.

## Deliverables

- `renderResumeRecord` (`feed-flow.ts:269-283`) renders one `KD<n>` / `NS<n>` line per member of `extra.key_decisions` / `extra.next_steps`, 1-based in array order.
- The cardinality line sits between the header and the first item line (spec D2: a lost-in-middle truncation of later content must not be able to strip it).
- `RESUME_COVERAGE_FLOOR` is emitted alongside the existing `RESUME_SCOPE_CLOSURE`.
- Same three additions on the MCP surface.

## ACs

AC-RC-1, AC-RC-2, AC-RC-3, AC-RC-5, AC-RC-6 — all in `packages/lore/tests/unit/feed-resume-coverage.test.ts`.

## Constraints

Spec D1: items derive from the structured arrays ONLY. Recovering items by parsing `record.content` is forbidden and AC-RC-6 is a zero-hit search that will fail if you do — content is a projection, and text-derived matching is the contiguous-substring false-oracle vector this repo has already measured. Depends on T1 constants. Do NOT write the e2e file; T4 owns it.
