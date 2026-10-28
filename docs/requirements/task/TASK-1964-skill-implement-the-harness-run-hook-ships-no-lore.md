---
id: TASK-1964
type: task
role: plan
title: "[Skill:implement] The harness-run hook ships no lore MCP matcher and rewrites only Bash input"
status: archived
priority: high
phase: "Phase 1: Remove consumers"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1959, type: blocks}
---
Estimate: M
Approach: remove the `mcp__.*lore_.*` matcher from packages/core/src/distribution-hooks.ts (~:184); remove the MCP branch of assets/hooks/pre-tool-harness-run.mjs (~:55-62, :91) so it rewrites only Bash input; remove `rewriteMcpInput` from packages/core/src/run-identity.ts (~:419-420) and the MCP branch of packages/lore/src/adapters/cli/commands/run.ts (~:59, :87-91, :426); update scripts/fresh-install-probe.ts (~:93-95, :150); reword the comment in distribution-hooks.ts (~:76) that cites register-mcp.ts as a precedent; regenerate packages/lore/src/generated/assets-manifest.ts (after T4 landed). Keep tests/fixtures/context-variables/pre-change-settings.json (historical).
Source: spec-remove-the-lore-mcp-server Scope; BR-1093 (proposed retirement).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-RMCP-6

Scenarios:
- Given the shipped distribution hooks, When the PreToolUse entries for pre-tool-harness-run are listed, Then no matcher contains `mcp__` (test titled with 'AC-RMCP-6' in unit/core/distribution-hooks.test.ts).
- Given the hook script and a tool input for `mcp__lore__lore_get`, When the hook runs, Then its output leaves the input unchanged; given a Bash `lore …` input, Then it is rewritten as before (test titled 'AC-RMCP-6' in unit/hooks/pre-tool-harness-run-hook.test.ts).
- Given an existing settings.json that still holds the old `mcp__.*lore_.*` group, When setup converges, Then report what happens (kept or removed) in the task evidence; if it is kept, file it with `lore report-issue` (do not change setup here — T2 owns setup).

Red-first: capture the failing tests before implementing, then capture the pass.

AC:
- `bun run test:file packages/lore/tests/unit/core/distribution-hooks.test.ts packages/lore/tests/unit/hooks/pre-tool-harness-run-hook.test.ts -t 'AC-RMCP-6'` exits 0 (AC-RMCP-6), red captured first.
- Delete integration/hooks/harness-run-any-server-name.test.ts; update core/tests/run-identity-rewrite.test.ts (~:150+), integration/cli/run-attest-input.bun.test.ts (~:76-95), unit/core/distribution-hooks.test.ts entry count (~:95); each passes via `bun run test:file`.
- `git grep -n "rewriteMcpInput\|mcp__\.\*lore_" -- packages scripts assets ':!packages/lore/tests/fixtures/**' ':!packages/lore/tests/integration/cli/setup-turn-end-review-roster.test.ts'` prints nothing (the roster test keeps legacy matcher data); `bun run typecheck` exits 0.
