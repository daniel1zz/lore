---
id: TASK-961
type: task
role: plan
title: "Run occupancy read and git-safety hook decide worktree removal by who is inside"
status: archived
priority: medium
phase: "occupancy"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-156
plan: PLAN-156
---
Covers AC-WL-1..5 of spec-worktree-removal-is-decided-by-who-is-inside-not-by-how (D1-D6). lore run occupancy --worktree <path> [--json] per the spec's Public Interface; store gains a read of runs by agent_ref (SQLite, Turso, InMemory); claim scan over non-terminal tasks matching branch or realpath (ENOENT -> path.resolve) with claim.harness_run end state. Hook probeWorktreeRemove: after clean+merged, spawn lore run occupancy --json (cwd = repo), lsof -n -d cwd -F pn excluding own ancestry; any occupied/unmeasurable -> refuse naming the signal and the way out; else pass (no --force) / today's SAFE text (--force). Delete WORKTREE_LIVENESS_WINDOW_MINUTES and minutesSinceLastReflogActivity; delete the retired reflog-window cases AC2/AC4 from git-safety-gate.test.ts (nothing skipped). Regenerate the assets manifest. Red-first.
