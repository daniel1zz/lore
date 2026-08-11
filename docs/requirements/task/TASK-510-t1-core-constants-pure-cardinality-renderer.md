---
id: TASK-510
type: task
role: plan
title: "T1 core constants + pure cardinality renderer"
status: archived
priority: medium
phase: "render"
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PLAN-100
plan: PLAN-100
links:
  - {id: TASK-509, type: blocks}
---
## Objective

Land in `@lore/core` the exported constants and the pure renderer the resume-ticket render path will consume.

## Deliverables

- `RESUME_COVERAGE_FLOOR` — the lower-bound declaration. A NEW exported constant, deliberately SEPARATE from `RESUME_SCOPE_CLOSURE` (spec D3: the two constrain opposite directions; merged into one string the absence of either half is undetectable by an identity assertion).
- Exported item-id prefixes for decisions and next steps, so the render path and the Stop hook cannot drift on tag format.
- A pure function taking the two array lengths and returning the cardinality line. Pure so AC-RC-2 can assert identity without constructing a ticket.

## ACs

Ships the isolated unit test for the constants and the pure renderer. AC-RC-2 and AC-RC-3 are asserted end-to-end from T2 once the render consumes them.

## Constraints

`RESUME_SCOPE_CLOSURE` text is UNCHANGED — the upper bound is out of scope. Do NOT touch `packages/lore/src/flows/feed-flow.ts`; T2 owns it.
