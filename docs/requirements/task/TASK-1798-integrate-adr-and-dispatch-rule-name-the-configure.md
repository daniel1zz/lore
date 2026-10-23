---
id: TASK-1798
type: task
role: plan
title: "integrate ADR and dispatch rule name the configured floor and its measured cost"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
ADR adr-main-advances-only-by-lore-integrate-per-session (line ~91) and the shipped worktree-dispatch rule fragment both name the floor as `bun run check:static`, but .lore/config.yaml:37 sets `bun install --frozen-lockfile && bun run check:floor` (14 steps, scripts/run-chain.ts:115-121; check:static adds 5 corpus-dependent checks, run-chain.ts:71-77). The ADR's cost section (~110 s per attempt) is contradicted by the 2026-10-19 measurement (~1080 s per attempt, 3/3 lost races). End state: the ADR is revised (or superseded) with the measured attempt cost from task-integrate-records-per-attempt-phase-durations-so-the and a decision on contention at that cost; the rule fragment names the configured floor by reading it, not a hard-coded script name.
