---
id: TASK-650
type: task
role: plan
title: "Wire the binary-provenance check into both byte-identical pre-push copies"
status: draft
priority: medium
phase: "binary-provenance"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-121
plan: PLAN-121
---
Implements AC-BFI-3 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Wire `lore status --check-binary-provenance` into the pre-push gate, in BOTH copies.

`hooks/pre-push` and `assets/project/pre-push` are a byte-identical parity-pinned pair. The repo copy
enforces locally; the assets copy is what `lore setup --project` installs into consumer repos. A fix
landed in only one is invisible to every consumer — the distribution-first rule
(adr-distribution-first-every-improvement-names-its-consumer).

## AC-BFI-3, measured RED by segment on 2026-08-11 before implementation

    diff hooks/pre-push assets/project/pre-push   -> exit 0   (parity currently holds)
    grep -q check-binary-provenance hooks/pre-push -> exit 1   (not wired)
    full command                                   -> exit 1

The parity segment passing is what makes this AC discriminating: the red comes from the missing
wiring, not from a pre-existing byte difference. Wire only one copy and the parity segment goes red
instead — both directions are live.

## Constraints

- Regenerate the assets manifest after editing `assets/` (`packages/lore/src/generated/assets-manifest.ts`).
- pre-push is fail-open when `lore`/`.lore/` are absent — keep that contract for the new check.
- The check must not make pre-push fail for consumers whose binary came from npm: that is
  AC-BFI-2's `not-a-dev-checkout` state exiting 0, which this task depends on but does not implement.
- ⛔ Depends on T1 landing the check. Coordinate: this task may be implemented against the check's
  documented interface, but its AC cannot go green until T1 merges.
