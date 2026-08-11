---
id: TASK-583
type: task
role: plan
title: "T1: worktree-derivation tier in resolveActorWithSource + claim identitySource + bun tests"
status: archived
priority: medium
phase: "P1-impl"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-107
plan: PLAN-107
links:
  - {id: TASK-554, type: blocks}
---
SPEC-104: new resolution tier explicit > env > worktree-derived agent:<branch> > os-fallback. Filesystem detection only (no git subprocess): cwd-upward .git FILE with gitdir: pointer, read HEAD via pointer, refs/heads/<branch> → agent:<branch>; .git DIRECTORY (main checkout) → legacy path; detached HEAD/unreadable → os-fallback fail-open, never throw. Thread identitySource 'worktree-derived' through ClaimOpts. Tests red-first, cover the five ACs incl. byte-identical legacy behavior (AC-ACTOR-3).
