---
id: TASK-1043
type: task
role: plan
title: "[Skill:implement] RunService + `lore run register | show | attest-input`"
status: archived
priority: high
phase: "P2 Runs and claims"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1026, type: blocks}
  - {id: TASK-1042, type: blocks}
  - {id: TASK-1033, type: blocks}
---
Estimate: M
Approach: per spec D2, D5, D10 — RunService persists and reads only; the `run register` command computes the composition with the existing fragment selection and passes it in; `run attest-input` reads a PreToolUse payload on stdin and prints hook JSON whose updatedInput comes from core rewriteBashCommand / rewriteMcpInput with the derived run id (prints `{}`-equivalent pass-through when the payload has nothing to rewrite)
Source: spec §Structure; existing lazy-registration pattern in adapters/cli/index.ts
Dimensions: D-FUNC, D-CODE
Scope-Alt: `run show --json` field order is negotiable
Covers: AC-RID-1, AC-RID-2, AC-RID-10

AC:
- Given `task-skill-test-red-lore-run-register-show-composition-record`'s three files, When each runs with `cd packages/lore && bun test <file>`, Then all pass.
- Integration: From a fresh `lore init` corpus, performing `lore run register` with fixture ids then `lore run show cc:<S>`, Then the run is printed; piping a fixture PreToolUse Bash payload containing `lore claim t` to `lore run attest-input` prints hook JSON whose updatedInput.command carries `--harness-run cc:<S>`.
