---
id: TASK-770
type: task
role: plan
title: "[Skill:test] evidence-capture attestation — RED test scenarios"
status: draft
priority: high
phase: "P1 Independent labels"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-769, type: blocks}
---
Estimate: S
Source: AC of the paired evidence-capture task; SPEC-143 AC-CT-2 and C5
TDD-Role: red | Paired-Impl: the AC-CT-2 evidence-capture task
Dimensions: D-FUNC

Scenarios:
- Given a throwaway corpus (mkdtemp + lore init, cwd inside it — ⛔ NEVER this repo's .lore/), When a passing oracle run is recorded through the REAL evidence-capture path, Then the stored row has capture_source "runner" AND an attestation block containing a measured exit_code.
- Given the same run, When the stored row is read back, Then attestation carries the elapsed time and the timed_out flag the adapter already measures from spawnResult — not placeholders.
- Given a run that FAILS (non-zero exit), When recorded through the same path, Then the attestation block is present with the real non-zero exit_code, so attestation presence is not conditional on success.
- ⛔ Given the schema alone, When inspected without driving the capture path, Then that inspection does NOT satisfy this criterion — AC-CT-2 requires driving production wiring end to end.

AC:
- All four scenarios exist as executable tests against a throwaway corpus.
- Running them before the implementation is RED, failing because the attestation block is absent — not because the test is malformed.
- ⛔ Red recorded by THIS agent at the moment it is red: lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail.
