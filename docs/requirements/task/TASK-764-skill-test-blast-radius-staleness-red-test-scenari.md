---
id: TASK-764
type: task
role: plan
title: "[Skill:test] blast-radius staleness — RED test scenarios"
status: deprecated
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-10-10
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
  - {id: TASK-763, type: supersedes}
---
⛔ RESTRUCTURED 2026-08-23: this task ABSORBED `task-skill-implement-blastradiuschanged-returns` (now invalidated, superseded by this doc). Reason, measured: `lore done` carries THREE independent conjunctive floors, and the third — `findMissingUnfilteredTestFileRuns` (`packages/lore/src/service/task-workflow-service.ts:2934`) — demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED, and offers NO escape hatch (the other two floors do: `--override-attestation`, `--declare-no-new-tests`). A RED-only task whose declared anchor IS the failing test file can therefore never archive, which deadlocks the paired impl task that `blocks` on it. Collapsing the pair into ONE archival unit satisfies all three floors truthfully: the red row comes from stage RED's agent, the attested unfiltered pass from stage GREEN's `lore verify`.

Structure: TWO SEQUENTIAL CLAIMS ON ONE TASK — stage RED then stage GREEN, each claimed by a DIFFERENT agent. Plan A D-A3 is preserved: the party that records the red must have no stake in it passing; the claim lease serialises them, and stage GREEN claims only after stage RED has released.

## Stage RED

Estimate: S
Source: AC of the paired blast-radius task; SPEC-143 AC-CT-4, C3; measured git semantics recorded in R8
TDD-Role: red | Paired-Impl: the AC-CT-4 blast-radius task
Dimensions: D-FUNC

Scenarios:
- Given a throwaway git repo and a recorded HEAD, When a peer commit touches a path INSIDE the declared radius, Then the earlier verdict classifies stale.
- Given the same repo, When a peer commit touches ONLY paths outside the radius, Then the verdict stays bound. ⛔ Without this half the "inside" case passes vacuously under an ancestry test.
- Given a radius pathspec that did NOT exist at the recorded HEAD, When a peer CREATES it, Then the verdict classifies stale; live control — a pathspec that never exists stays bound.
- Given an AC whose command yields NO pathspec at all (e.g. `bun run typecheck`), When the radius is resolved, Then it classifies unmeasured; live control — a sibling AC yielding one still classifies bound.

AC:
- All four scenarios exist as executable tests against a throwaway git repo.
- RED before implementation.
- ⛔ Red recorded by THIS agent at the moment it is red: `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail --ac AC-CT-4`.
  ⛔ The `--ac` reference is mandatory, not decoration: without it the red is free prose and "which ACs have an observed-red falsifier" stays unqueryable corpus-wide — the exact residual SPEC-143's own Falsifier-debt section names.


## Stage GREEN — absorbed verbatim from the invalidated impl task

Estimate: M
Approach: per SPEC-143 C3 and AC-CT-4 (v51). Implementation MUST be `git diff --quiet <recorded HEAD> HEAD -- <pathspecs>`; the return type is RadiusMeasurement from P0, NOT `boolean | "unmeasured"` (retired in R9 as the loose primitive-plus-sentinel union real-git-port.ts forbids in its own source). Memoize per distinct digest — measured ~10.9ms per spawn, ruinous per row.
Source: SPEC-143 C3, AC-CT-4, D4, Revision Record R8 (the measured git exit semantics).
Dimensions: D-FUNC
Scope-Alt: memoization could ship separately, but 200 rows = 2.2s of pure fork, so it is in scope.
Covers: AC-CT-4

Blocked by P0 (consumes RadiusMeasurement).

⛔ RESOLVABILITY IS A PATHSPEC PROPERTY, NOT AN EXISTENCE PROPERTY. Measured 2026-08-20: `git diff --quiet <rev> HEAD -- <p>` exits 1 for a path created after `<rev>`, 1 for one deleted after it, and 0 if it never existed — existence is irrelevant to soundness. An existence-based rule would classify every red-first AC unmeasured (29% of this corpus vs 6% under the pathspec rule).

AC:
- Given a peer commit inside the declared radius, Then stale; outside it, Then bound.
- Given a pathspec absent at the recorded HEAD but created by a peer, Then stale; live control — one that never exists stays bound.
- Given an AC yielding no pathspec, Then unmeasured; live control — a sibling yielding one still classifies bound.
- ⛔ Run both declared falsifiers once and record each: (a) swap the diff for `merge-base --is-ancestor` → exits EXACTLY 1, and note (b) still passes under ancestry while (a) breaks; (b) make resolvability require existence → exits EXACTLY 1 on the created-pathspec half.


⛔ Stage GREEN closes with `lore verify`, NOT a hand-recorded pass — one attested run of the declared AC command must also be an UNFILTERED run of every `.test.ts` anchor on this task, or the third floor above will refuse the archive.
