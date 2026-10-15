---
id: TASK-1181
type: task
role: plan
title: "W7 blind reader and separate grader on the re-probe"
status: archived
priority: medium
phase: "P5-Remediate"
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PLAN-177
plan: PLAN-177
links:
  - {id: TASK-1180, type: blocks}
---
Reader sees only the re-probe's questions and an export of the remediated specification/execution/review baseline docs; answers each with basis and confidence sure|unsure. A separate grader sees only the key and the answers. Scoring rules (fixed, identical to attempt 1): per question 1 = every sub-question answered and substantively correct (exit codes count only if the question asks for them); 0.5 = at least one sub-question correct and none contradicted, but a sub-part missing or 'not stated'; 0 = any sub-part contradicts the key, or nothing correct. Confident-wrong = marked sure AND any sub-part contradicts the key; a missing part is not wrong. An exit code the reader says is not given counts as missing. Bar: total >= 9/10 and confident-wrong == 0. Re-probe constraints (checked before reading): 10 questions, >= 6 assigned to review by the placement ADR, the rest specification/execution. AC: AC-BLS2-16 bar 1. Estimate: S
