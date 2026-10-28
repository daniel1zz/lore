---
id: TASK-2095
type: task
role: plan
title: "Wire --declare-no-change into the CLI and the lore_done tool, compiled e2e (AC-ND-6)"
status: deprecated
priority: high
phase: "P3 Wiring and close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-2094, type: blocks}
---
Covers: AC-ND-6
Approach: done.ts declares the flag as the literal "declare-no-change" (the AC-ND-6 falsifier) and passes the reason to TaskWorkflowService.done; lore_done gains declare_no_change (string, same blank-reason refusal). The e2e test builds nothing itself: it runs dist/lore (built by bun run build) against a throwaway corpus, then checks --help, a no-change close through the MCP tool, plan close of a single-task plan, and the milestone review input.
Done when: AC-ND-6 passes under lore verify.
