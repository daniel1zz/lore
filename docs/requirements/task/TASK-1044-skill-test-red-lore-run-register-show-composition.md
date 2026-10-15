---
id: TASK-1044
type: task
role: plan
title: "[Skill:test] RED — lore run register / show / composition record"
status: archived
priority: high
phase: "P2 Runs and claims"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1043, type: blocks}
---
Estimate: M
Source: AC-RID-1, AC-RID-2, AC-RID-10 statements
TDD-Role: red | Paired-Impl: `task-skill-implement-runservice-lore-run-register-show-attest`
Covers: AC-RID-1, AC-RID-2, AC-RID-10

Scenarios (mkdtemp + lore init corpus):
- Given fixture session S and agents A1, A2, When `lore run register` runs for main, A1, A2, Then three runs exist and A1/A2 name `cc:S` as parent; registering main again keeps one row and the first registered_at.
- Given a subagent of type lore-implementer, Then its composition lists exactly the fragment ids `lore fragments render --outlet hook:subagent-start --agent-type lore-implementer --explain` selects, each with the sha256 of that fragment file; after editing one fragment a new run differs only in that hash.
- Given a registered run, When `lore run show <id>` (and `--json`), Then kind, parent, session, branch and fragments are printed; Given an unknown id, Then exit is the NOT_FOUND exit code and stderr names the id.

AC:
- Given the three test files, When each runs with `cd packages/lore && bun test <file>` before `lore run` exists, Then each fails on the missing command, recorded with `lore evidence --result expected-fail --output-tail-file`.
