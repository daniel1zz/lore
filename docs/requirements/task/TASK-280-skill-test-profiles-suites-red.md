---
id: TASK-280
type: task
role: plan
title: "[Skill:test] Profiles suites — RED"
status: archived
priority: critical
phase: "Phase 1: Profiles slice"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-070
plan: PLAN-070
links:
  - {id: TASK-278, type: blocks}
  - {id: TASK-279, type: blocks}
---
Estimate: S
Source: SPEC-058 AC-V-1..3
TDD-Role: red | Paired-Impl: V2
Covers: AC-V-1, AC-V-2, AC-V-3
Scenarios:
- Given ai-mode-only ACs and a configured floor, When checkOracleCoverage, Then finding names the missing oracle (NEGATIVE: ai does not satisfy)
- Given unconfigured corpus, When spec promotes, Then byte-identical to frozen baseline
- Given design-spec plan without requires_uat, When promoted, Then blocked with repair command; then archives end-to-end through plan-close gate when satisfied
AC:
- All three named suites exist and are RED for missing-implementation reasons only
