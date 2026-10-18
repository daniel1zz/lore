---
id: TASK-1559
type: task
role: plan
title: "[Skill:implement] IV-5 Invocation resolved once at the entry and delivered through wrapDefault; delete invocation-identity"
status: archived
priority: medium
phase: "P3 entry"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
links:
  - {id: TASK-1558, type: blocks}
---
Implement spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4. Invocation type in @lore/core (no Node import), resolver in @lore/core/node reusing resolveTargetDir / resolveUserConfigDir. runCli(inv); wrapDefault hands inv to each command run. Delete invocation-identity.ts and its setter; migrate its readers.
