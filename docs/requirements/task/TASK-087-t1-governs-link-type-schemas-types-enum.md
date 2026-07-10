---
id: TASK-087
type: task
role: plan
title: "T1: governs link type (schemas + types enum)"
status: archived
priority: high
phase: "Core: governs + feed"
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-021
plan: PLAN-021
links:
  - {id: TASK-085, type: blocks}
---
## Task Objective
Add `"governs"` as a new link type: append to `linkTypeSchema` z.enum (`packages/core/src/schemas.ts`) AND the `LinkType` union (`packages/core/src/types.ts`). Semantics: `from=skill, to=artifact` (the skill governed/fed that artifact's production). Plain typed edge — no lifecycle/validation coupling beyond existing link rules.

## Spec Reference
spec-p4-upstream-downstream-linkage-feed-before-produce-protocol §5.2, §6 (chose new `governs` over reusing `informs` / a new table). AC-P4-6.

## Acceptance Criteria
- `governs` accepted by `lore link <a> <b> --type governs`; rejected values still rejected.
- All existing link-type tests + full `bun run test:vitest` + `bun run test:bun` green (regression — existing 6 types untouched).
- `bun run typecheck` clean.

## Context Digest
`linkTypeSchema` is at `packages/core/src/schemas.ts:58` (enum: parent/implements/informs/supersedes/relates-to/blocks); mirror in `types.ts:37` union. This is purely additive. Check whether any exhaustive switch on LinkType exists (grep) that now needs a `governs` arm.

## File Anchors
- EDIT `packages/core/src/schemas.ts` (linkTypeSchema), `packages/core/src/types.ts` (LinkType)
- EDIT/READ link-type unit tests
