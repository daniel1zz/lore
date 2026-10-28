---
id: TASK-2090
type: task
role: plan
title: "Red tests and v8 fixtures for declared judge-visible fields"
status: draft
priority: high
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-264
plan: PLAN-264
links:
  - {id: TASK-2116, type: blocks}
  - {id: TASK-2089, type: blocks}
  - {id: TASK-2069, type: blocks}
---
Covers: AC-JV-1, AC-JV-2, AC-JV-3, AC-JV-4, AC-JV-5
TDD-Role: red
Approach: FIRST capture v8 builder output for a spec, a plan, a task and a baseline leaf into tests/fixtures/review-prompt-v8/ from the unmodified template (AC-JV-4's false-green guard). JV-1 iterates each extra schema's shape keys (z.object .shape; passthrough schemas use their declared shape). JV-2/JV-3 name it() blocks 'AC-JV-2' and 'AC-JV-3'. JV-5 uses ReviewService + InMemoryAIProvider and asserts the recorded prompt.
Done when: JV-1, 2, 3, 5 run red; JV-4 is red on the version assertion only (fixtures match); expected-fail captured.
