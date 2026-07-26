---
id: PLAN-065
type: plan
role: plan
title: "Implementation — SPEC-061 attestation completeness guard"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-21
tags: []
parent: SPEC-061
---
# Implementation — SPEC-061 attestation completeness guard

## Goal

Close the `lore verify` false-attestation blind spot found during SPEC-060:
a test oracle that matches zero (or fewer than declared) files still exits 0
and is recorded as an attested pass.

## Sequencing

Single slice, single implementer. The pure core module (D1) and its
`VerifyRunnerService` integration (D3) are small and tightly coupled through
one call site; splitting them across worktrees would cost more in interface
reconciliation than it saves (SPEC-060 T1/T4 precedent — a field-shape
mismatch surfaced only at merge).

## Exit Criteria

- All 7 ACs attested via `lore verify`.
- `bun run typecheck` exit 0; both test runners green.
- The guard's own oracle commands verified to execute the file count they
  declare (dogfooding the very defect being fixed).
