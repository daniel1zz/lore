---
id: TASK-1935
type: task
role: plan
title: "X1 an agent's anchor removal on a non-draft document carries a decision"
status: archived
priority: medium
phase: "X"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-244
plan: PLAN-244
---
Resolves #483. AC-DX-1. Gate lore anchor rm (code_anchors on spec / knowledge; find the service behind commands/anchor.ts rm, likely DriftCheckService anchor RMW verbs) through the existing decision gate (decision-gate.ts / decision-wiring.ts / decision-flags.ts) when the target is not a draft and the writer is an agent run; store the decision on the version row the removal creates. lore anchor add stays ungated. CLI decision flags on lore anchor rm.
