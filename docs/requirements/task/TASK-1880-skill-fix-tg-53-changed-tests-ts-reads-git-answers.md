---
id: TASK-1880
type: task
role: plan
title: "[Skill:fix] TG-53 changed-tests.ts reads git answers from Bun spawnSync stdout; a lost stdout makes test:changed silently select nothing"
status: archived
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: TG-51 left one flake risk: scripts/changed-tests.ts runGit for `rev-parse --show-toplevel` and `merge-base` returns "" when Bun spawnSync loses stdout (TG-49: status 0 + empty stdout ~1/6000), and a lost `git diff --name-only` reads as "nothing changed" — test:changed would silently select nothing. Make answers that must be non-empty on success (toplevel, merge-base) fail loud when empty; for diff --name-only, cross-check with an exit-status channel (e.g. `git diff --quiet` exit 1 = changes exist) so empty stdout + changes-exist fails loud. Add an injectable seam and tests titled TG-53.
Source: TG-51 report
AC: injected empty-stdout tests red before, green after; test:changed tests pass.
