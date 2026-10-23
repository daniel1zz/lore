---
id: TASK-1721
type: task
role: plan
title: "Checking out main in a nested worktree blocks every session's integrate and nothing refuses it at checkout"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
links:
  - {id: PLAN-223, type: relates-to}
  - {id: SPEC-222, type: relates-to}
---
Problem: one agent can block every session's `lore integrate`. On 2026-10-19 an implementer subagent (plan-baseline-coverage-refuse-only-undeclared-commands-strip, T1) created a nested worktree `.claude/worktrees/agent-a66dd8ce6d9cbf19c/.scratch/red` for red runs with the `main` branch checked out (not detached). BR-1273 then refused integration for all sessions until another session noticed and asked for `git checkout --detach main`. Nothing refuses creating such a worktree; the only signal is every other session's integrate failing.

End state to design: checking out `main` in any non-shared worktree is refused at the point it happens (or made impossible), not discovered later by other sessions' integrate. Candidates: a git `post-checkout` / reference-transaction hook in hooks/ that refuses `main` outside the shared checkout; or `lore integrate` naming the owning run/session of the offending worktree in its refusal so the owner is found mechanically. Pick by: does it hold with no human present and with concurrent sessions.

AC: creating a worktree with `main` checked out outside the shared checkout exits non-zero naming BR-1273's cause, on a throwaway repo; `git worktree add --detach <p> main` still succeeds.
