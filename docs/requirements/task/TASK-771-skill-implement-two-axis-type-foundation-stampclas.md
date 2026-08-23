---
id: TASK-771
type: task
role: plan
title: "[Skill:implement] Two-axis type foundation — StampClass, RadiusMeasurement, StampCurrency, readStampVerdict, StateStamp, ARMING_REV"
status: draft
priority: critical
phase: "P0 Type foundation"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-766, type: blocks}
  - {id: TASK-764, type: blocks}
  - {id: TASK-762, type: blocks}
  - {id: TASK-760, type: blocks}
  - {id: TASK-758, type: blocks}
---
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
