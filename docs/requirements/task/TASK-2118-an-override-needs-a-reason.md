---
id: TASK-2118
type: task
role: plan
title: "An override needs a reason"
status: draft
priority: medium
phase: "AI decisions"
created: 2026-10-25
updated: 2026-10-25
tags: []
parent: PLAN-271
plan: PLAN-271
links:
  - {id: TASK-2091, type: blocks}
---
## Objective
Refuse (exit 4, nothing written) an approval or rejection that overrides the latest judgment without a non-empty --calibration-note; store the note and the decider origin on the comparison; report override share and override-with-reason share in question A.

Spec: spec-ai-decision-correctness-outcome-attribution-and-audit (BR-288, BR-296 modified; BR-1390). Resolves #407.

Covers: AC-AD-4
