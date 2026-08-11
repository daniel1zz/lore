---
id: TASK-657
type: task
role: plan
title: "Resolve verifyFalsifier's execution root through SPEC-063 so a falsifier run from a linked worktree sees that worktree's uncommitted code"
status: draft
priority: high
phase: "falsifier-root"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-123
plan: PLAN-123
---
AC-JV-3 / D5. verify-runner-service.ts:1414-1418 verifyFalsifier resolves its root at :1528-1529 as const repoRoot = this.config.repoRoot; createFalsifierScratchWorktree(repoRoot). config.repoRoot comes from findLoreDbPath, which walks UP from the caller cwd and lands on the MAIN checkout whenever the caller is in a linked worktree — so a falsifier mutates and compiles main's code, never the caller's uncommitted work, silently and with a green. SPEC-063 already ships a pure resolveVerifyExecutionRoot for exactly this; _runFalsifier does not call it. Wire it. The reverse control is MANDATORY and belongs in the same oracle: assert that the worktree-rooted resolution DOES observe an uncommitted change made only in the worktree, and that the config.repoRoot path does NOT — without both halves the test cannot distinguish resolved-correctly from happened-to-pass.
