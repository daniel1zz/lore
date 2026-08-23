---
id: TASK-772
type: task
role: plan
title: "[Skill:test] Two-axis type foundation — RED test scenarios"
status: archived
priority: critical
phase: "P0 Type foundation"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
  - {id: TASK-764, type: blocks}
  - {id: TASK-760, type: blocks}
  - {id: TASK-762, type: blocks}
  - {id: TASK-766, type: blocks}
  - {id: TASK-771, type: supersedes}
---
⛔ RESTRUCTURED 2026-08-23: this task ABSORBED `task-skill-implement-two-axis-type-foundation-stampclass` (now invalidated, superseded by this doc). Reason, measured: `lore done` carries THREE independent conjunctive floors, and the third — `findMissingUnfilteredTestFileRuns` (`packages/lore/src/service/task-workflow-service.ts:2934`) — demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED, and offers NO escape hatch (the other two floors do: `--override-attestation`, `--declare-no-new-tests`). A RED-only task whose declared anchor IS the failing test file can therefore never archive, which deadlocks the paired impl task that `blocks` on it. Collapsing the pair into ONE archival unit satisfies all three floors truthfully: the red row comes from stage RED's agent, the attested unfiltered pass from stage GREEN's `lore verify`.

Structure: TWO SEQUENTIAL CLAIMS ON ONE TASK — stage RED then stage GREEN, each claimed by a DIFFERENT agent. Plan A D-A3 is preserved: the party that records the red must have no stake in it passing; the claim lease serialises them, and stage GREEN claims only after stage RED has released.

## Stage RED

Estimate: S
Source: SPEC-143 C1/C2, AC-CT-9(c); real-git-port.ts::BranchMeasurement as the shape precedent
TDD-Role: red | Paired-Impl: the P0 type-foundation task
Dimensions: D-CODE

Scenarios:
- Given the five StampVerdict readings, When readStampVerdict is called with each of the five (stamp,radius) combinations, Then it returns bound / stale / radius_unmeasured / unbound / legacy_unbound respectively and the returned set has size 5.
- Given a sixth hypothetical StampClass member added to the union, When tsc compiles, Then the build FAILS at readStampVerdict's never exhaustiveness check (compile-failure fixture, not a runtime assertion).
- Given a RadiusMeasurement value, When it is {status:"measured",changed:true} and {status:"unmeasured"}, Then both arms are constructible and narrow correctly; ⛔ a bare boolean or the string "unmeasured" MUST NOT type-check as RadiusMeasurement.
- Given StateStamp and ARMING_REV, When imported from @lore/core, Then no Node builtin is pulled into the browser-safe barrel (the dashboard imports it).

AC:
- All four scenarios exist as executable tests/fixtures.
- Running them BEFORE the implementation lands is RED, and the failure reason is "missing implementation" (unresolved import / unknown symbol), NOT a test bug.
- ⛔ The red is recorded by THIS agent at the moment it is red: lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail.


## Stage GREEN — absorbed verbatim from the invalidated impl task

Estimate: M
Approach: per SPEC-143 C1 + C2 (v51). RadiusMeasurement is structurally identical to packages/lore/src/adapters/real-git-port.ts::BranchMeasurement — a discriminated union, NEVER a primitive-plus-sentinel union; that file's own source states the rule and the reason.
Source: SPEC-143 Components C1/C2 and Revision Record R9; sibling precedents BranchMeasurement (object union) and gate-predicates.ts::SessionComparison (bare three-valued string, used where no payload is carried).
Dimensions: D-CODE
Scope-Alt: none — every other chain in P2 consumes this. Cannot be descoped.
Covers: (foundation for AC-CT-3, AC-CT-4, AC-CT-5, AC-CT-8, AC-CT-9)

Declare in packages/lore/src/service/gate-predicates.ts:
  type StampClass = "stamped" | "unbound" | "legacy_unbound"
  type RadiusMeasurement = {status:"measured";changed:boolean} | {status:"unmeasured"}
  interface StampCurrency { stamp: StampClass; radius: RadiusMeasurement; reason?: string; field?: string }
  type StampVerdict = "bound"|"stale"|"radius_unmeasured"|"unbound"|"legacy_unbound"
  function readStampVerdict(c: StampCurrency): StampVerdict   // total, never-exhaustive
Declare in packages/core/src/task-workflow.ts: StateStamp value object (optional on attestation) and the ARMING_REV constant.

AC:
- Given all five (stamp, radius) combinations, When readStampVerdict projects each, Then the five results are pairwise distinct and cover the product exhaustively.
- Given an added StampClass member, When tsc runs, Then the build fails at readStampVerdict — asserted by a compile-failure fixture, not prose.
- Given RadiusMeasurement, When a bare boolean or the literal "unmeasured" is assigned to it, Then tsc rejects the assignment.
- Integration (⛔ the shape must be provably consumable BEFORE four parallel chains build on it): a compile-only consumer fixture constructs all five verdict readings and both radius arms through the public exports and type-checks clean under `bun run typecheck`.
- ⛔ stampCurrency's own BEHAVIOUR is NOT in this task — only the types plus readStampVerdict. The classification logic is AC-CT-3's.


⛔ Stage GREEN closes with `lore verify`, NOT a hand-recorded pass — one attested run of the declared AC command must also be an UNFILTERED run of every `.test.ts` anchor on this task, or the third floor above will refuse the archive.
