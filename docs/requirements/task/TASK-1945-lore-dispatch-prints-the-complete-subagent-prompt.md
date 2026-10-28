---
id: TASK-1945
type: task
role: plan
title: "lore dispatch prints the complete subagent prompt from the contract and one shipped standing-rules file (AC-LND-1)"
status: deprecated
priority: high
phase: "P3 Land, dispatch, log, drift"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1946, type: blocks}
---
Covers: AC-LND-1
TDD-Role: green
Approach: dispatch-service.ts renders a pure function of (task body, stored contract, standing-rules file). The standing rules (branching base, scoped oracles, commit before attest, no destructive version-control commands, evidence recorded by the agent that ran it) are written once in packages/lore/assets/dispatch-standing-rules.md; the dispatch code never inlines them. A task with no contract, or of kind check or corpus, is refused with exit 4 (check/corpus output names lore finish). commands/dispatch.ts is registered in index.ts in the same task.
Done when: AC-LND-1 passes through the compiled binary, including the edit-the-asset-and-the-output-changes assertion; typecheck passes.
