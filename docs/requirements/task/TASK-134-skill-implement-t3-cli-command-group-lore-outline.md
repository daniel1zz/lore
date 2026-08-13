---
id: TASK-134
type: task
role: plan
title: "[Skill:implement] T3 CLI command group lore outline (set/list/rm/exempt)"
status: archived
priority: critical
phase: "Phase 1: Core schemas & outline writer"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-126, type: blocks}
  - {id: TASK-124, type: blocks}
---
Estimate: M
Approach: new commands/outline.ts citty command group (set/list/rm/exempt) — thin pipes over PrdOutlineService, registered as lazy subcommand in adapters/cli/index.ts (additive), inheriting the SPEC-051 wrapCommandStrict seam automatically.
Source: SPEC-080 C1/C4; adapters/cli/CLAUDE.md thin-adapter invariants; `lore phase`/`lore ac` command-group precedents
Dimensions: D-FUNC, D-CODE
Scope-Alt: MCP `lore_outline` tool parity deferred to a follow-up (spec commits CLI only).
Covers: AC-080-2, AC-080-4 (CLI halves)

AC:
- Given T3r RED suite, When run post-implementation, Then all GREEN.
- Given `lore outline --help` style intro, When any subcommand misused (missing positional), Then exit 2 with usage, never a stack trace.
- Exit-code mapping honors utils.ts::exitCode SSOT (4 = VALIDATION_ERROR etc.).
- `bun run typecheck` exit 0.

Integration: command reachable from compiled binary dispatch (index.ts lazy import table) — verified by the bun integration suite invoking the real CLI entry.
