---
id: TASK-759
type: task
role: plan
title: "[Skill:implement] probeOccupancy and the SKIPPED-and-continue contract, surfaced in real lore status"
status: draft
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
---
> ⚠ INVALIDATED 2026-08-23T05:32:32.534Z — superseded by task-skill-test-occupancy-skipped-and-continue-with-its-live; Absorbed into the surviving paired task as its stage GREEN. lore done's third floor (findMissingUnfilteredTestFileRuns, task-workflow-service.ts:2934) has no escape hatch and demands an unfiltered result:pass per declared .test.ts anchor, so a RED-only task owning the failing test file can never archive and deadlocks whatever blocks on it. One task, two sequential claims by two agents.

Estimate: M
Approach: per SPEC-143 C6 and AC-CT-8 (v51). probeOccupancy() reports MACHINE occupancy — a live pid holding the checkout-level lock — as opposed to active_sessions, which reports INTENT occupancy (claim leases with a TTL). Export it read-only from scripts/oracle-lock.ts.
Source: SPEC-143 C6, AC-CT-8, QA-5, goal G5.
Dimensions: D-FUNC, D-ERROR
Scope-Alt: none — G5 ("no new check can wedge an unattended loop") has no other asserting criterion.
Covers: AC-CT-8

Blocked by P0 (the stamp is what the check skips binding).

⛔ OCCUPANCY IS THE ONLY SKIP TRIGGER. An earlier form of AC-CT-8 also named "the export index is contended"; that was removed in R11 because C7's integer-compare form writes nothing and therefore cannot race the shared export index — asserting a skip on index contention would assert an unreachable state.

AC:
- Given occupancy present, When the check runs, Then SKIPPED + exactly one audit row, and the exit code equals a check-absent control run of the same fixture.
- Given occupancy released, When the same check runs, Then a real verdict, not SKIPPED (live control).
- Integration: after a skip, spawning the real `lore status` shows the literal token SKIPPED on a line also containing `state-binding` — the user surface, not an internal field.
- ⛔ Run all three declared falsifiers once and record each: (a) make the check exit 1 instead of emitting SKIPPED when it cannot decide → exits EXACTLY 1; (b) make it always return SKIPPED → exits EXACTLY 1 on the live-control half; (c) drop the audit-row write → exits EXACTLY 1.
