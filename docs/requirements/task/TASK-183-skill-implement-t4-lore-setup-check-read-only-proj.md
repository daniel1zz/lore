---
id: TASK-183
type: task
role: plan
title: "[Skill:implement] T4 lore setup --check read-only projection + check cache"
status: archived
priority: critical
phase: "Phase 2: Core freshness logic"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-182, type: blocks}
  - {id: TASK-178, type: blocks}
---
Estimate: M
Approach: commands/setup.ts gains --check flag (bootstrap-stage, no loadLoreApp — same exemption as setup itself). Reads embedded manifest const (from generated module via binary) + installed manifest + RealFsProbe → planUpdate → render summary + per-state file lists; --json emits {summary, binary_version, installed_binary_version, installed_at, files:{outdated[],diverged[],missing[],orphaned[]}}. Exit 0 all-sync / 3 otherwise (orphaned alone stays 0). Writes the check cache file (SetupCheckCache shape) and NOTHING else (Invariant I4/D-PLAN-4). --check composes with --project (project ledger target) but NOT with --uninstall/--dry-run (exit 2 mutex).
Source: SPEC-076 §C3 §C6 cache shape; SPEC-051 strict-flag seam auto-covers new declared flag
Dimensions: D-FUNC, D-CODE
Scope-Alt: --project composition can defer to follow-up if ledger probe diverges structurally — must then exit 2 on --check --project naming the gap, never silently check global only
Covers: AC-076-2

AC:
- Given a fresh converged install, When `lore setup --check` runs, Then exit 0 (unpiped) and cache file exists with status="sync"
- Given one managed file's bytes mutated, When --check runs, Then exit 3 and --json lists exactly that path under files.diverged
- Given --check run twice, Then manifest + all target files' mtimes unchanged except the cache file (zero-write invariant asserted)
- Given --check with --uninstall or --dry-run, Then exit 2 naming the mutex
- Integration: cd packages/lore && bun test tests/integration/setup-check.bun.test.ts green (test file authored in-task, red-then-green commits)
