---
id: TASK-1996
type: task
role: plan
title: "Compiled e2e for every shell form, concurrent subagents and a fresh install"
status: approved
priority: critical
phase: "P4 End to end and distribution"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-2003, type: blocks}
---
Covers: AC-RV-2, AC-RV-7, AC-RV-8
Approach: tests run dist/lore built by bun run build against throwaway corpora; the agent harness marker is set so the human-session path cannot make a write pass. RV-2 iterates the spec's shell-form table through bash -c with the prefix; sudo is asserted as refused with the 'removed' cause (not run as root: a fake sudo that clears env). RV-7 starts both attest-input calls and all 40 writes together. RV-8 runs lore setup into a temporary HOME and project, then pipes a Bash payload into the INSTALLED hook file. distribution-hooks.ts keeps the Bash matcher entry verbatim (falsifier literal).
Red-first: record each command red before the P2+P3 integrate lands, then green after.
