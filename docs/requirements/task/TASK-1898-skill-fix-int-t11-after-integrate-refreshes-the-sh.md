---
id: TASK-1898
type: task
role: plan
title: "[Skill:fix] INT-T11 after integrate refreshes the shared checkout, its build artifacts (dist/lore) are not rebuilt, leaving the installed lore older than main"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
---
Estimate: S
Approach: After `lore integrate` lands and refreshes the shared checkout, the shared checkout's dist/lore (the binary ~/.local/bin/lore links to, and the one CLAUDE.md's "a dist/lore older than HEAD is refused" rule checks) is NOT rebuilt — the floor built only inside the integration worktree (observed 2026-10-19 after landing AU-T25 as 2395d578: the orchestrator had to run `bun run build` in the shared checkout). Make the binary freshness part of the integrate contract: after a refreshed shared view, rebuild its build artifacts (project config key, e.g. workflow.integrate.post_refresh_command, this repo: `bun run build`), reporting rebuilt / failed / skipped(kept-dirty) — or decide with evidence that the binary should be built from the integration worktree and installed into the view; no silent staleness. Build must not leave tracked changes in the view (check and report if it does).
Red-first: after an integrate in a throwaway repo with a fake build command, the view's artifact equals the new main's (red today).
Source: AU-T25 landing 2026-10-19
AC: test green; AC-INT-1/2 pass.
