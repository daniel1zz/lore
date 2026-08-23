---
id: TASK-760
type: task
role: plan
title: "[Skill:test] occupancy SKIPPED-and-continue with its live control — RED test scenarios"
status: draft
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
  - {id: TASK-759, type: supersedes}
---
⛔ RESTRUCTURED 2026-08-23: this task ABSORBED `task-skill-implement-probeoccupancy-and-the-skipped-and` (now invalidated, superseded by this doc). Reason, measured: `lore done` carries THREE independent conjunctive floors, and the third — `findMissingUnfilteredTestFileRuns` (`packages/lore/src/service/task-workflow-service.ts:2934`) — demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED, and offers NO escape hatch (the other two floors do: `--override-attestation`, `--declare-no-new-tests`). A RED-only task whose declared anchor IS the failing test file can therefore never archive, which deadlocks the paired impl task that `blocks` on it. Collapsing the pair into ONE archival unit satisfies all three floors truthfully: the red row comes from stage RED's agent, the attested unfiltered pass from stage GREEN's `lore verify`.

Structure: TWO SEQUENTIAL CLAIMS ON ONE TASK — stage RED then stage GREEN, each claimed by a DIFFERENT agent. Plan A D-A3 is preserved: the party that records the red must have no stake in it passing; the claim lease serialises them, and stage GREEN claims only after stage RED has released.

## Stage RED

Estimate: S
Source: AC of the paired occupancy-skip task; SPEC-143 AC-CT-8, C6, QA-5, G5
TDD-Role: red | Paired-Impl: the AC-CT-8 occupancy-skip task
Dimensions: D-FUNC, D-ERROR

Scenarios:
- Given a throwaway corpus with occupancy PRESENT (a live pid holding the checkout-level lock), When the state-binding check runs, Then it emits SKIPPED, writes exactly one audit row, and the exit code EQUALS the same fixture's exit code with the check ABSENT. ⛔ Assert by running BOTH, never by hard-coding 0 — other pre-push checks may legitimately fail.
- Given occupancy RELEASED, When the SAME check runs, Then it produces a real verdict, NOT SKIPPED. ⛔ Live control: without it, an implementation that always skips passes the first scenario while G5 holds in name only.
- Given the skip has occurred, When the real `lore status` binary is spawned, Then its stdout contains the literal token SKIPPED on a line that ALSO contains the literal check identifier `state-binding`. ⛔ Not an internal field read; not a bare non-empty-output assertion.

AC:
- All three scenarios exist as executable tests against a throwaway corpus.
- RED before implementation.
- ⛔ Red recorded by THIS agent at the moment it is red: `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail --ac AC-CT-8`.
  ⛔ The `--ac` reference is mandatory, not decoration: without it the red is free prose and "which ACs have an observed-red falsifier" stays unqueryable corpus-wide — the exact residual SPEC-143's own Falsifier-debt section names.


## Stage GREEN — absorbed verbatim from the invalidated impl task

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


⛔ Stage GREEN closes with `lore verify`, NOT a hand-recorded pass — one attested run of the declared AC command must also be an UNFILTERED run of every `.test.ts` anchor on this task, or the third floor above will refuse the archive.
