---
id: TASK-792
type: task
role: plan
title: "[Skill:implement] lore setup --check read-only health probe for the gh channel"
status: archived
priority: medium
phase: "P0: Runner + error taxonomy"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-775, type: blocks}
---
Estimate: S
Approach: extend the existing `lore setup` command with a read-only `--check` path that calls GhRunner for `gh --version`, `gh auth status`, a repo read, and `rate_limit`. Read-only: precedent is that setup writes only its own cache file.
Source: spec Migration Plan P0 ("read-only health check in lore setup --check")
Dimensions: D-FUNC, D-UX
Scope-Alt: the rate_limit probe can be dropped without blocking the plan; the three preconditions cannot
Covers: AC-GI-2

Scope.in: the PRE-FLIGHT discoverability half of AC-GI-2 — an operator can find out WHY filing will fail before attempting it.
Scope.out: the RUNTIME refusal path (exit code + stderr remedy on an actual `lore report-issue`) belongs to the GhRunner task in this phase. These two tasks cover AC-GI-2 from opposite ends and neither is sufficient alone.

AC:
- Given the anchored test file from the paired red task, When it runs, Then all cases pass
- Given a machine with `gh` absent, When `lore setup --check` runs, Then its exit code is non-zero and its stderr names `cli.github.com`
- Given a fully configured machine, When `lore setup --check` runs, Then exit 0 and no file outside setup's own cache is modified (asserted by a git-clean check in the test)
- A full-repo typecheck is exit 0

Integration: this task's surface IS user-facing (`lore setup --check`), so its AC drives the CLI surface, not the underlying function.
