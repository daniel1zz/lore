---
id: TASK-2086
type: task
role: plan
title: "Red tests: evidence check by task status, draft review reaches the judge"
status: deprecated
priority: high
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-265
plan: PLAN-265
links:
  - {id: TASK-2085, type: blocks}
---
Covers: AC-EC-1, AC-EC-2
TDD-Role: red
Approach: EC-1 builds a ReviewBundle per status (draft, in_review, approved, active, deprecated, archived with and without evidence) and asserts the five-check order plus each outcome and detail. EC-2 uses ReviewService with InMemoryAIProvider over an in-memory store: a well-formed draft task, assert judge_provider and exactly one provider call.
Done when: both commands run red; expected-fail captured.
