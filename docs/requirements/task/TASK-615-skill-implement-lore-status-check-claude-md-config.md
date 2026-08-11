---
id: TASK-615
type: task
role: plan
title: "[Skill:implement] lore status --check-claude-md — config-only pre-app branch"
status: archived
priority: critical
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-613, type: blocks}
---
Estimate: M
Approach: per spec D9 — `--check-claude-md` flag on lore status; branch short-circuits BEFORE loadLoreApp (config-only: load .lore/config.yaml if present else defaults; run probe + lintMemoryFiles; render findings; exit 3 on any, else 0; repair pointer prints `lore governance claude-md`). Restate status command description as repo + corpus health.
Source: spec §D9 + cohesion-review hard defect (status.ts loadLoreApp precedes check branches today)
Dimensions: D-CODE, D-FUNC
Scope-Alt: finding rendering can start plain-text; --json projection may defer to a follow-up
Covers: AC-CMC-1 (wiring half)

AC:
- Given the paired RED suite, When implementation lands, Then `bunx vitest run packages/lore/tests/integration/status-claude-md.test.ts` GREEN, matched count asserted
- Given existing status checks (--check-tree/--check-drift/--check-prd-budget), When run on this repo, Then behavior unchanged (regression)
- Integration: running `lore status --check-claude-md` in THIS repo exits 0 (repo is under ceilings post-compression) — real-corpus smoke via read-only invocation
