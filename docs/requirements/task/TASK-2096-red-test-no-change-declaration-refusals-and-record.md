---
id: TASK-2096
type: task
role: plan
title: "Red test: no-change declaration refusals and record (AC-ND-1..5)"
status: deprecated
priority: high
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-2093, type: blocks}
---
Covers: AC-ND-1, AC-ND-2, AC-ND-3, AC-ND-4, AC-ND-5
TDD-Role: red | Paired-Impl: task 'Implement the no-change landing declaration'
Approach: one throwaway corpus per case (mkdtemp + lore init; never the repo's .lore/). Real git repo with a main branch and a worktree branch per case: gone (branch deleted), 0 ahead, 1 ahead. Name every it() with its AC id so -t 'AC-ND-n' selects it. Assert exit codes exactly, the fixed floor name in output, and for every refusal that status, extra.landing and the audit count are unchanged. AC-ND-5 starts both lore done processes before awaiting either.
Done when: each AC-ND-1..5 command runs red; record each with lore evidence --result expected-fail --capture.
