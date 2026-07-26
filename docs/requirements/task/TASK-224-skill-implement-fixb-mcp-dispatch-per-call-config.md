---
id: TASK-224
type: task
role: plan
title: "[Skill:implement] FixB mcp+dispatch — per-call config getter, shared checkpoint descriptor, combo rejection"
status: archived
priority: high
phase: "mcp-dispatch"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-048
plan: PLAN-048
---
Estimate: M
Approach: Three review findings in the MCP/dispatch layer:
(F6/AC-070-15) config snapshot staleness — MCP lore_feed's task-start branch closes over the LoreConfig parsed once at server start; CLI re-reads per process, so long-lived-server parity breaks after a config edit. Change the threading to a GETTER: `registerTools(server, app, getConfig?: () => LoreConfig | undefined)` (or equivalent additive shape); `startMcpServer` forwards it; packages/lore/src/index.ts passes a closure that re-runs the same config load the CLI entry uses (extract/reuse the existing load from the loader path — do NOT hand-roll a second yaml read; check adapters/cli/loader.ts and @lore/core/node loadConfig for the canonical function). The branch calls getConfig() per invocation. All existing no-arg call sites stay valid (additive optional param). Test: swap the getter's return between two lore_feed calls on one server; second pack's truncated[] changes (AC-070-15).
(F7+F8/AC-070-16) dispatch triplication + schema laxness — export ONE descriptor map from flows/feed-flow.ts, e.g. `SPECIAL_FEED_CHECKPOINTS: Record<checkpoint, {requiredArg: "task"|"phase"|null}>` covering session-resume/phase-start/task-start; commands/feed.ts's handler table derives its membership from it (handlers stay adapter-local — deps differ — but a checkpoint present in the descriptor and missing a handler must fail loud at module init, not silently fall through); MCP tools.ts iterates the same descriptor for branch membership + required-arg validation. Add contradictory-combo rejection on MCP lore_feed: task-start+phase, phase-start+task, and any NON-special checkpoint carrying task or phase → VALIDATION_ERROR naming the offending field (CLI already exits 2 on its own arg paths — do not change CLI behavior). Byte-pins from AC-070-7 + the new AC-070-18 pin (landing in the parallel task) guard the refactor; run the existing integration suite only if the parallel task's changes are not yet merged — otherwise rely on your scoped vitest oracles.
Source: spec AC-070-15,16; architecture finding 1 (three-way manual SSOT — feed-flow.ts:129-143 comment, feed.ts table, tools.ts branches); Codex findings 3,4.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none.
Covers: AC-070-15, AC-070-16

AC:
- Given a getter whose return changes between two lore_feed calls on one server, when the second task-start pack builds, then its truncated[] reflects the new budgets (AC-070-15)
- Given the exported descriptor map, when CLI table and MCP branches resolve membership, then both consume it, a descriptor entry without a CLI handler fails loud at init, and contradictory MCP field combos exit VALIDATION_ERROR (AC-070-16)

Integration: MCP tool call sequence against a real InMemoryStore App proves per-call config freshness without server restart.

Oracle scope (SCOPED only): bunx vitest run packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts (assert matched count); bunx vitest run packages/lore/tests/unit/adapters/mcp-tools-feed.test.ts if it exists (regression); bunx vitest run --changed <merge-base>; bun run typecheck.
