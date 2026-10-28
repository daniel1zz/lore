---
id: TASK-1937
type: task
role: plan
title: "F2 the decision re-check re-runs only commands whose every flag is on a closed allowlist"
status: archived
priority: medium
phase: "F"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-245
plan: PLAN-245
---
Resolves #482. AC-DR-7. decision-recheck.ts isRerunnableCommand uses a command-name allowlist plus a flag deny-list (FORBIDDEN_FLAG ~:85), so flags that run programs or write files still pass (rg --pre-glob / -z / --search-zip, git grep -O / --open-files-in-pager, git -c <key>=<val>, any unlisted lore subcommand flag). Replace with a closed allowlist per command (grep/rg: a small set of read-only matching flags; git show/log/diff/grep: a small read-only set; lore get|list|search|tree|rule show|rule find|ac list|log: --json and their read-only filters), reject any git global option before the subcommand, reject shell metacharacters as today; anything else is not-rerunnable. Add AC-DR-7 cases for each named bypass.
