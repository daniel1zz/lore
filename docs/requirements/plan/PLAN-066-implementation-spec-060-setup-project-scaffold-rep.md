---
id: PLAN-066
type: plan
role: plan
title: "Implementation — SPEC-060 setup --project scaffold + repo ledger"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-21
tags: []
parent: SPEC-060
---
# Implementation — SPEC-060 setup --project scaffold completion + repo ledger

## Goal

Land SPEC-060's six design decisions (D1–D6) behind its 7 attested ACs, without
regressing the machine-target `SetupService` path.

## Sequencing

T1 is the foundation: it introduces the repo-level manifest seam inside
`flows/setup-project-flow.ts` that every later step writes through. T2 also
touches that file, so it is anchor-blocked on T1. T3 (CLI verb) and T4
(renderer) touch disjoint files and run concurrently with T2.

## Exit Criteria

- All 7 ACs attested via `lore verify` (exit-code-derived, never self-reported).
- `bun run typecheck` exits 0; `bun run test` green on both runners.
- Any deviation from the spec's stated design recorded in the plan assessment.
