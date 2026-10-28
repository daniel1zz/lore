---
id: TASK-1975
type: task
role: plan
title: "Red tests: export prefix, ancestry verification, refusal causes, retired flag"
status: approved
priority: critical
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-2001, type: blocks}
  - {id: TASK-1999, type: blocks}
---
Covers: AC-RV-1, AC-RV-3, AC-RV-4, AC-RV-5, AC-RV-6, AC-RV-9, AC-RV-10, AC-RV-11
TDD-Role: red
Approach: RV-1 table = every shell form in the spec's 'Every shell form in #418' section, plus a command without lore and a subagent payload; assert the whole output string. RV-3/RV-5 use a fake process-table port (parentOf, startTimeOf) and a fake settings reader; one case per row of the spec's Verification table. RV-4 runs lore claim with --harness-run and asserts exit 2 exactly. RV-6 drives the tool server in-process with a registered run whose harness pid is / is not an ancestor. Throwaway corpora only.
Done when: each command runs red; lore evidence --result expected-fail --capture per AC.
