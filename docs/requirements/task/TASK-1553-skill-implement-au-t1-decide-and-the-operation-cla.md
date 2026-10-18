---
id: TASK-1553
type: task
role: plan
title: "[Skill:implement] AU-T1 decide() and the operation-class registry in @lore/core"
status: archived
priority: critical
phase: "Phase 1a: core"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1552, type: blocks}
  - {id: TASK-1543, type: blocks}
---
Estimate: M
Approach: Pure decide(class, subject, facts) in packages/core/src/autonomy/ (default barrel, no Node builtin). Registry: per class tier, required factors, R path, threshold, prior (spec Scope class table). Factor tables R/B/E/J from the spec; required factor unmeasured -> 0; optional J absent -> excluded. Hard rules first, then min. Return {verdict, score, factors, reasons}; refuse for unknown class / malformed facts. Table-driven red-first test with the six halves (+4b).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-1.
