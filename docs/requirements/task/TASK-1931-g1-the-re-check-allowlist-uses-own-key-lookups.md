---
id: TASK-1931
type: task
role: plan
title: "G1 the re-check allowlist uses own-key lookups"
status: archived
priority: medium
phase: "G"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-242
plan: PLAN-242
---
AC-DR-7. decision-recheck.ts: GIT_FLAGS (~:118, looked up at ~:167 as GIT_FLAGS[first]) and any other table keyed by command or subcommand name are plain object literals, so inherited keys (constructor, __proto__, toString, hasOwnProperty, valueOf) pass. Use Map (or Object.hasOwn) for every such lookup; an unknown or inherited key is not-rerunnable, never a crash. Add AC-DR-7 cases: git constructor x, git __proto__ x, git toString x (not-rerunnable, runner not called) and git constructor -x (not-rerunnable, no throw); same for any top-level command table (e.g. a command named constructor).
