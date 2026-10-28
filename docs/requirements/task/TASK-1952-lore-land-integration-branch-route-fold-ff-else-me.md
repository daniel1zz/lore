---
id: TASK-1952
type: task
role: plan
title: "lore land, integration-branch route: fold ff-else-merge, and plan close at the last fold (AC-LND-3, AC-LND-4)"
status: deprecated
priority: high
phase: "P3 Land, dispatch, log, drift"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1947, type: blocks}
---
Covers: AC-LND-3, AC-LND-4
TDD-Role: green
Approach: land-service.ts gains the integration-branch route: fold the task tip into the plan's integration branch (fast-forward when the branch head is an ancestor of the tip, else merge; a conflict is refused with exit 4 naming the files and leaving the branch unchanged), and log a folded entry. When no code task of the plan remains unfolded, integrate the branch into main through IntegrateService (BR-1348 judges the branch against all its tasks), run verify and done for every task, then plan close: lore rule apply for the plan's spec, the code-anchor check, assess. A failing rule apply is exit 4 naming the criteria without an attested pass. plan-integration-branch-service.ts gains the creation of an absent branch at main's head, used by start. Wiring: the route is selected from the stored contract's landing_route inside the already-registered land command.
Done when: AC-LND-3 and AC-LND-4 pass through the compiled binary; typecheck passes.
