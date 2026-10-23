---
id: TASK-1621
type: task
role: plan
title: "B3b untrack the self-referencing node_modules symlink committed by B3's follow-up; ignore node_modules as file or directory"
status: archived
priority: medium
phase: "B"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Main broke after c2ca65f3: commit 6cbb4b08 added node_modules as a symlink to itself (the follow-up worktree lived outside the repo and symlinked node_modules); .gitignore's node_modules/ matches directories only. Shared-checkout rebuild failed: bun install ELOOP, build 'Cannot find package yaml'. Fix: git rm --cached node_modules; .gitignore node_modules (no slash). Oracle: bun install --frozen-lockfile && bun run build in the shared checkout after landing.
