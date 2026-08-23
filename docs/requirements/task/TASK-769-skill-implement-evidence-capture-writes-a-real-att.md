---
id: TASK-769
type: task
role: plan
title: "[Skill:implement] evidence-capture writes a real attestation from data it already measures"
status: draft
priority: high
phase: "P1 Independent labels"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
---
Estimate: S
Approach: per SPEC-143 C5 — the adapter ALREADY measures spawnResult.status, elapsedMs and timed_out and simply never writes them. This is a write-through fix, not new measurement.
Source: SPEC-143 C5 and AC-CT-2 (v51).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — this is the smallest chain in the plan and unblocks nothing else, but AC-CT-2 is in scope and C5 also starves deriveAcCoverageState's attested_pass branch, so descoping it would leave that branch untestable.
Covers: AC-CT-2

Independent of the P0 type foundation — consumes no new type, so it dispatches immediately and runs parallel to P0.

AC:
- Given a throwaway corpus, When a passing oracle run is recorded through the real evidence-capture path, Then the persisted row carries capture_source "runner" AND an attestation block whose exit_code is the measured spawn status.
- Given a failing run through the same path, When the row is read back, Then the attestation block is present with the real non-zero exit_code — presence is unconditional on outcome.
- Given the corpus after the change, When every evidence row is scanned, Then ZERO rows carry capture_source "runner" without an attestation block.
- ⛔ Run the declared falsifier once and record it: delete the attestation write while leaving the runner label in place, and assert the AC-CT-2 command exits EXACTLY 1. A pass never observed able to fail is not evidence.
- ⛔ Use a throwaway corpus for every smoke check. Writing to this repo's .lore/ is forbidden (2026-07-07 pollution incident).
