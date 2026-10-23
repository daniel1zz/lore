---
id: TASK-1892
type: task
role: plan
title: "[Skill:fix] INT-T5 lore commands that write tracked files (context refresh, fragments render, setup --project, mirror export) write into the invoking worktree, not the corpus's checkout"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
links:
  - {id: TASK-1893, type: blocks}
  - {id: TASK-915, type: resolves}
---
Estimate: M
Approach: MI-T2 (2026-10-18) ran `lore context refresh` inside its agent worktree; because a linked worktree has no lore.db, findLoreDbPath resolves the corpus beside the git common dir (correct, BR-802/§M4) — and the command then derived its WRITE target (repo root for CLAUDE.md and .claude/rules) from the corpus path (`dirname(dirname(dbPath))`, adapters/cli/commands/context.ts), so it rewrote the shared main checkout's CLAUDE.md. Under adr-main-advances-only-by-lore-integrate-per-session every session edits tracked files only in its own worktree, so the corpus location and the working tree a command writes tracked files into are two different facts: corpus = common-dir resolution; tracked-file target = the invoking working tree (git rev-parse --show-toplevel of the cwd, through the Invocation). Inventory every lore command that writes tracked repository files (context refresh/init/add/remove, fragments render, setup --project, mirror export, anything computing a repo root from the db path — grep `dirname(dirname(` and repoRoot derivations) and make each write into the invoking working tree; a command run outside any git working tree keeps today's behaviour. No fallback: if the toplevel cannot be measured, refuse naming it.
Red-first: in a throwaway repo with a linked worktree, `lore context refresh` from the worktree changes the worktree's CLAUDE.md and leaves the main checkout's bytes identical (red today).
Source: MI-T2 report 2026-10-18
AC: red-first test green for each inventoried command; corpus reads/writes still resolve the shared corpus.
