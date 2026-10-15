---
id: TASK-1041
type: task
role: plan
title: "[Skill:test] RED — run-register and pre-tool-harness-run hooks (fail-open, blind pipe)"
status: archived
priority: high
phase: "P4 Adapter and distribution"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1042, type: blocks}
---
Estimate: S
Source: AC-RID-3; spec D7, D10; existing pattern tests for session-start-fragments.mjs
TDD-Role: red | Paired-Impl: `task-skill-implement-hooks-run-register-mjs-and-pre-tool`
Covers: AC-RID-3

Scenarios:
- Given PATH without lore, When run-register.mjs gets a SessionStart payload, Then exit 0 and stdout has one additionalContext line naming the failure; same for lore exiting 3 and for malformed stdin.
- Given a stub lore on PATH, Then run-register spawns `lore run register` with kind main / subagent and the payload's ids.
- Given a Bash payload without the word lore, Then pre-tool-harness-run exits 0 without spawning anything; with `lore claim t`, Then it relays the stub's hook JSON verbatim; with lore failing, Then exit 0 and no updatedInput.

AC:
- Given the two files, When `bunx vitest run <file>` before the hooks exist, Then they fail on the missing scripts, recorded with `lore evidence --result expected-fail --output-tail-file`.
