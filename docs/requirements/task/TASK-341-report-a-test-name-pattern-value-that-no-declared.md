---
id: TASK-341
type: task
role: plan
title: "Report a test-name-pattern value that no declared acceptance criterion binds"
status: archived
priority: medium
phase: "mechanisms"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
plan: PLAN-081
links:
  - {id: TASK-339, type: blocks}
---
Per the governing spec M3 — the CHECK only; wiring it into `lore status` belongs to the surfacing task.

A `-t` / `--testNamePattern` / `--test-name-pattern` value present in a repo test file that NO declared AC binds is reported. This is how a silently WITHDRAWN claim becomes visible: the test keeps passing and nothing says the criterion that used to own it is gone. Live instance from this session: `-t false-positive-bound` on `packages/core/tests/unit/ac-quality.test.ts` is bound by ZERO ACs after AC-ACQ-7 was restated.

Ship as a script under `scripts/`, in the shape `check-ac-ref-integrity.ts` already establishes (its `-core` split included, if that shape applies).

⛔ Do NOT edit any `commands/*.ts` — the surfacing task's anchors cover `lore status`.
⛔ Report-only. No exit-code gating in this slice.
