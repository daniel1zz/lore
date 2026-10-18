---
id: TASK-1551
type: task
role: plan
title: "[Skill:fix] AU-T6 agent hygiene: no stash steer, no self-matching waits, helpers reap on signals, tracked files stay clean"
status: draft
priority: high
phase: "Phase 1a: core"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1543, type: blocks}
---
Estimate: M
Approach: (1) remove stash steer from lore-implementer.md:36 and the gate safe-hints (assets/hooks/pre-bash-git-safety-gate.mjs:591/597/603 — text only, refusals unchanged); name commit-the-test-first or lore verify --falsify; scan script with scripts/agent-hygiene-allowlist.json. (2) termination discipline: wait on a recorded pid, forbid pgrep -f polling; scan flags until/while ... pgrep -f. (3) run-process-group.ts: SIGTERM/SIGINT handlers reap child groups and re-raise. (5) find and fix the sources that dirty tracked files in a worktree build + scoped run (mirror export side effects, assets-manifest regeneration). Verify assets from a fresh consumer install.
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function; RCA 2026-10-18 section B
AC: AC-AU-6.
