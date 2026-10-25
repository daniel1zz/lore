---
id: TASK-1770
type: task
role: plan
title: "Coverage floor prints failing pairs last so a bounded failure tail always shows what to fix"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Found 2026-10-19 landing worktree-agent-adb495ab08f7af038: the floor refused at check:baseline-coverage with "3252 ledgered (debt), 4 unaccounted, 327 stale (informational)" — and the 4 unaccounted pairs were NOT in the integrate output. run-chain re-prints the failed step's last 40 lines (task-integrate-floor-failure-shows-the-failing-step-s-own), but scripts/check-baseline-coverage.ts prints the 327 informational "stale debt row" lines AFTER the unaccounted ones, so the bounded tail kept only informational lines. The refusal again did not say what to fix.

End state: the coverage floor script prints informational lines first (or collapses them to one counted line with a pointer to the full list command), and the failing items — every unaccounted pair with its fix line — last, immediately before the summary line, so any bounded tail carries them. Never truncate the failing items themselves; if they exceed the run-chain bound, the summary names how many and the command that lists them all.

AC: red-first — a render with 4 unaccounted pairs and 327 stale rows: the last 40 lines contain all 4 unaccounted pairs and their fix lines; falsifier: today's order.
