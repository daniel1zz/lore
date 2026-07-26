---
id: PLAN-064
type: plan
role: plan
title: "Implementation — SPEC-063 verify execution-root correctness"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-21
tags: []
parent: SPEC-063
---
# Implementation — SPEC-063 verify execution-root correctness

## Goal

Stop `lore verify` from attesting against the wrong tree when invoked inside a
linked worktree. Third false-attestation vector in two days; the first two
(SPEC-060 mistyped paths, SPEC-061 under-match oracles) are closed.

## Sequencing

Single slice: the pure resolver, its service wiring, the attestation fields and
the CLI line are one coherent change through a single call site. Splitting
would repeat the SPEC-060 T1/T4 interface-mismatch cost.

## Exit Criteria

- All 6 ACs attested via `lore verify` run FROM THE MAIN CHECKOUT.
- `bun run typecheck` exit 0; both runners green.
- AC-063-2 demonstrably fails against pre-change code (the REPRO must be shown red first).
