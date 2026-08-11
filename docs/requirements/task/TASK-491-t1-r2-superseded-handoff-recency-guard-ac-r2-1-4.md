---
id: TASK-491
type: task
role: plan
title: "T1 R2 superseded-handoff recency guard (AC-R2-1..4)"
status: archived
priority: medium
phase: "Fix"
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-093
plan: PLAN-093
---
# T1 — R2 superseded-handoff gains R3's recency guard

## Task Objective
`computeArchiveCandidates` R2 flags a superseded handoff only once it is older than `handoffTtlMinutes`, so a concurrently-live session's ticket cannot reach the sweep — while R2 stays distinct from R3.

## Spec Reference
`lore get spec-superseded-handoff-archival-has-no-recency-guard` — D1-D4 binding.

## Acceptance Criteria
AC-R2-1 … AC-R2-4 (this task's declared `ac_scope`).

## Context Digest — measured, do not re-derive
- `packages/core/src/archive-candidates.ts` — R2 groups by `JSON.stringify([doc.parent_id, handoff.by])` and flags every non-newest member of a group ≥2 with **no age and no plan condition**. R3 (expired) has BOTH `age > handoffTtlMinutes` (strict) AND planless-or-plan-terminal. That asymmetry is the defect.
- Planless handoffs all carry the root PRD as `parent_id`, so the key degenerates to actor alone.
- The function is PURE: `nowIso` and TTLs are injected. No clock, no store — tests construct `DocRecord`s directly.
- R3 already skips `supersededIds` to preserve one-candidate-per-doc; R2 must KEEP precedence so the reported `reason` names supersession (D3).
- ⛔ The guard reads the **superseded** doc's age, never the superseding doc's (D2). Reading the wrong one inverts the protection and still passes any young-case-only test.

## File Anchors
- `packages/core/src/archive-candidates.ts`
- `packages/core/tests/unit/archive-candidates-recency.test.ts` (new)

⛔ Do NOT commit `packages/lore/src/generated/assets-manifest.ts`.

## Test discipline (binding)
- RED first: AC-R2-1 must fail against unmodified code (today R2 flags regardless of age).
- ⛔ Never write to this repo's own `.lore/` corpus.
- `-t` title filters exit 0 on ZERO match — copy titles literally, assert `Tests N passed` with N > 0.
