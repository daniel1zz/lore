---
id: PLAN-050
type: plan
role: plan
title: "Plan — SPEC-070 deterministic task dispatch bundle"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: SPEC-070
phases:
  - {name: "core-cli", description: "config + shared types + pure flow + wiring + render + CLI dispatch (AC-070-1..7)"}
  - {name: "mcp-parity", description: "MCP lore_feed task-start + phase-start branches (AC-070-8)"}
---
# Plan — SPEC-070 deterministic task dispatch bundle

## Goal
Implement SPEC-070: `lore feed task-start <task>` — render-only pure flow over a
pre-derived thick bundle, wired config budgets, exported render module,
table-driven feed dispatch, MCP parity incl. closing the SPEC-056 phase-start
MCP gap.

governance_mode: unattended

## Invariants
- Flow module stays render-only: no domain-derivation imports (AC-070-1's grep-able property).
- `spec-create` / `session-resume` / `phase-start` CLI outputs byte-unchanged through the dispatch refactor (AC-070-7).
- `@lore/core` default barrel stays browser-safe (config schema edit touches config.ts only — no Node imports).
- Worktree oracles stay SCOPED (AC test files + typecheck + `vitest --changed`); full suite runs once on main post-merge by the orchestrator.
- No writes to the repo's own `.lore/` from tests — throwaway corpus (`mkdtemp` + `lore init`) for the CLI integration test.

## Phases
- core-cli: config + shared types + pure flow + wiring + render + CLI dispatch (AC-070-1..7)
- mcp-parity: MCP lore_feed task-start + phase-start branches (AC-070-8) — serialized behind core-cli; anchors `adapters/mcp/tools.ts`, which a concurrent SPEC-069 session may also touch

## Risk Register
- M: `commands/feed.ts` table-driven refactor regresses an existing checkpoint path → mitigated by AC-070-7 regression pins + scoped integration test.
- M: `tools.ts` anchor conflict with live SPEC-069 session → mitigated by phase serialization + anchor-overlap gate + merge-time re-check.
- L: config schema addition collides with concurrent config edits → `workflow.task_feed` is a new subtree, additive.

## Decisions Log
- Two tasks, serial: contested-anchor isolation (tools.ts) is the split criterion; no parallelism to harvest in this subsystem.
