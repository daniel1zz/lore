---
id: TASK-2093
type: task
role: plan
title: "Implement the no-change landing declaration"
status: deprecated
priority: high
phase: "P2 Landing predicate"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-2095, type: blocks}
---
Covers: AC-ND-1, AC-ND-2, AC-ND-3, AC-ND-4, AC-ND-5
TDD-Role: green | Paired-Red: task 'Red test: no-change declaration refusals and record (AC-ND-1..5)'
Approach: spec Design and Public interface. taskLandingSchema gains kind ('integrate' | 'no-change'); readTaskLanding returns kind 'integrate' for a stored record without it. checkNoChangeDeclaration(task, reason) runs P1..P8 in order and returns a refusal with a fixed floor name or the record. The falsifier literals in the spec's Public interface appear verbatim, once each. findNotLandedFloor accepts landing.kind === 'no-change' before its commit check. The landing write and the first status step are one CAS write on expected_version: noChangeBase.version. lore get prints 'Landing: no-change — <reason>' or 'Landing: <commit>'. milestone-review.ts lists a no-change task with no commit range. Scoped-oracle floor: every file importing task-commit-range.ts and milestone-review.ts.
Done when: AC-ND-1..5 pass (lore verify on the plan), and lore evidence --capture is recorded for the touched importers' tests.
