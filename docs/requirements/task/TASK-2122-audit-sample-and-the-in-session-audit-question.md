---
id: TASK-2122
type: task
role: plan
title: "Audit sample and the in-session audit question"
status: draft
priority: medium
phase: "AI decisions"
created: 2026-10-25
updated: 2026-10-25
tags: []
parent: PLAN-271
plan: PLAN-271
links:
  - {id: TASK-2127, type: blocks}
  - {id: TASK-2092, type: blocks}
  - {id: TASK-2123, type: blocks}
  - {id: TASK-2124, type: blocks}
---
## Objective
Compute the deterministic ~5% weekly sample (hash bucket, no claim, no write) and make `lore pending --ask` add at most one audit question (oldest unaudited sampled judgment of the last 4 weeks) to an ask that already goes to a person; record the verdict only from the ask channel human answer (unique per judgment and person); `lore pending` keeps listing 0 audit items (AC-LG-14).

Spec: spec-ai-decision-correctness-outcome-attribution-and-audit (BR-1392, BR-1393).

Covers: AC-AD-5, AC-AD-6
