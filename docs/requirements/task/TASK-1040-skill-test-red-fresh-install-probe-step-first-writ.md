---
id: TASK-1040
type: task
role: plan
title: "[Skill:test] RED — fresh-install probe step 'first-write-attested'"
status: archived
priority: high
phase: "P4 Adapter and distribution"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1038, type: blocks}
---
Estimate: S
Source: AC-RID-16; root CLAUDE.md distribution rule (verify from a fresh consumer install)
TDD-Role: red | Paired-Impl: `task-skill-implement-distribute-the-hooks-hook-registrations`
Covers: AC-RID-16

Scenarios:
- Given a throwaway project after `lore init` + `lore setup`, Then settings register run-register.mjs on SessionStart and SubagentStart and pre-tool-harness-run.mjs on PreToolUse (Bash, mcp__.*lore_.*).
- Given fixture SessionStart and PreToolUse payloads fed to the installed hooks, When the rewritten `lore claim` runs, Then the claim's audit row carries the session's run.

AC:
- Given the new probe step, When `bun run build > /dev/null 2>&1 && bun scripts/fresh-install-probe.ts --bin dist/lore` runs before `task-skill-implement-distribute-the-hooks-hook-registrations`, Then the step FAILs naming the missing hook registration, recorded with `lore evidence --result expected-fail --output-tail-file`.
