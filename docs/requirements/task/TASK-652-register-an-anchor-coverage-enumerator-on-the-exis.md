---
id: TASK-652
type: task
role: plan
title: "Register an anchor-coverage enumerator on the existing COUNT_FIELD_ENUMERATORS seam"
status: archived
priority: medium
phase: "anchor-ratchet"
created: 2026-08-11
updated: 2026-08-17
tags: []
parent: PLAN-121
plan: PLAN-121
---
Implements AC-BFI-4 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Make anchor coverage enumerable through the EXISTING count/enumerator seam.

⛔ Do NOT invent a parallel `unanchored_slugs[]` field. `lore status --enumerate <field>` already
exists (AC-FR-5 of spec-falsifiability-reachability, backed by `COUNT_FIELD_ENUMERATORS`), it
already refuses an unregistered field by name, and its contract is that every count derives its
number from the member list's length rather than a separately-tallied counter. Register the anchor
coverage count into that seam.

## Measured today (2026-08-11)

    lore status --json                        -> code_anchor_specs: 87   (of 142 live specs)
    lore status --enumerate code_anchor_specs -> exit 4, "no enumerator registered for count field",
                                                 known fields: capture_source_runner_count,
                                                 capture_source_self_report_count,
                                                 pass_unfalsified_count,
                                                 unredeemed_allow_missing_path_count

So today it is a bare count with no member list — exactly the shape AC-FR-5 forbids, sitting on the
very field this plan's ratchet depends on.

## AC-BFI-4

The oracle MUST spawn the real `lore` binary and read its stdout — this is a user-facing surface
claim, and calling the service function directly would attest a capability the surface may not
expose. Declared RED: (a) report the count with no registered enumerator -> the enumerate call exits
4 and the test fails; (b) register an enumerator returning a TRUNCATED list while leaving the count
correct -> the derive-from-length assertion must catch it.

## Dependency

⛔ BLOCKED on T1 (`task-embed-build-provenance-...`): both tasks anchor
`packages/lore/src/adapters/cli/commands/status.ts`, so the anchor-overlap gate will refuse a
concurrent claim. Claim this only after T1 has merged into main.
