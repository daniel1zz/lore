---
id: TASK-276
type: task
role: plan
title: "[Skill:test] Core contracts — RED scenarios"
status: archived
priority: critical
phase: "Phase 1: Core contracts"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-273, type: blocks}
---
Estimate: S
Source: SPEC-056 AC-P-1, AC-P-2
TDD-Role: red | Paired-Impl: core contracts implement task
Covers: AC-P-1, AC-P-2
Scenarios:
- Given empty ac_scope and all checklist items dropped, When computePhaseCompletion, Then state=vacuous and never done
- Given fresh claim expired mid-checklist, When recomputed after re-claim, Then state=active with prior evidence intact
- Given malformed acScope entry / negative TTL, When computed, Then typed err (no throw)
- Given evidenced AC id removed, When assertScopeFreeze, Then err; Given additive edit, Then ok (matched pair)
AC:
- >=16 scenarios written as executable vitest tests in the two named files
- All RED with failure reason "missing implementation" (not test bugs)
