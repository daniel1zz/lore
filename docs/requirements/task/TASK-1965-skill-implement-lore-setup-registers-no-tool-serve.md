---
id: TASK-1965
type: task
role: plan
title: "[Skill:implement] lore setup registers no tool server and writes no mcp manifest entry"
status: archived
priority: critical
phase: "Phase 1: Remove consumers"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1959, type: blocks}
---
Estimate: L
Approach: delete `packages/core/src/register-mcp.ts` (+ its export in packages/core/src/index.ts ~:77) and `packages/lore/src/adapters/real-mcp-registrar.ts`. In `packages/lore/src/service/setup-service.ts` remove the McpRegistrar port, McpAddOutcome, SetupReceipt.mcp, the synthetic kind "mcp" manifest entry (~:705-726, :785), the carry-forward of a previous mcp entry on a failed install (~:726), and the uninstall mcpRegistrar.remove() call (~:970-976). KEEP `stripMcpEntries` (~:1177) and the uninstall skip of kind === "mcp" (old manifests). In packages/core/src/setup-manifest.ts give the installer a written-entry kind type that excludes "mcp" (the parsed manifest type keeps it), so the installer cannot write an mcp entry (ADR decision 3). In `adapters/cli/commands/setup.ts` remove CapturingMcpRegistrar, mcpOutcomeExitCode, the MCP leg of combineSetupExit, the confirmation-prompt MCP line (~:1027). In `adapters/cli/setup-render.ts` remove renderMcpLine / mcpErrorTail (keep the Exclude<…,"mcp"> read type if still needed). Fix comments in setup-args.ts (~:47, :274), setup-github-health.ts (~:269), scripts/publish-npm.ts (~:24/37/349/794).
Source: spec-remove-the-lore-mcp-server Scope + rules BR-814/815/816/826/844 (proposed modifications on that spec).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-RMCP-2

Scenarios:
- Given a throwaway HOME/project and a fake `claude` on PATH logging argv, When `lore setup` installs, Then exit exactly 0, the log has no `mcp` argv, the manifest has no kind "mcp" entry, the --json receipt has no `mcp` key.
- Given the same, When install re-runs unchanged, Then exit 0 and no file written (BR-816) and still no claude call.
- Given a global uninstall, Then exit 0 and no claude call.
- Given a pre-existing manifest containing an `mcp:lore` entry, When install runs, Then exit 0, no claude call, the written manifest has no mcp entry.

Red-first: capture the failing tests before implementing, then capture the pass.

AC:
- `bun run test:file packages/lore/tests/integration/cli/setup-registers-no-tool-server.bun.test.ts` exits 0 (AC-RMCP-2), red captured first.
- Delete the RealMcpRegistrar describes in tests/unit/adapters/real-setup-ports.test.ts and the `register-mcp` describe in tests/unit/core/setup-pure.test.ts (~:396).
- Add scenario coverage: `lore setup --dry-run` makes no claude call (BR-814) and a global uninstall over a manifest holding kind "mcp" exits 0 without calling claude (BR-844) — both in setup-registers-no-tool-server.bun.test.ts.
- Update interface users: unit/service/setup-service.test.ts, setup-render.test.ts, setup-render-next-steps.test.ts (~:177/199/239/261), integration/setup-backup-prune.bun.test.ts (OkMcpRegistrar), integration/cli/setup.test.ts (~:217-224, :350-356).
- Tests that expected exit 1 because MCP registration failed under PATH="" now expect exit 0: setup-check, setup-converge-diverged, setup-manifest-fields, retirement-registry, dc2-setup-install-retired-files, cli/setup-turn-end-review-roster, e2e/setup-freshness-cycle, e2e/run-message-address-e2e (comments only in asset-install-variables, context-fragments-compiled, npm-install-simulation). Each changed assertion carries a one-line comment naming this task.
- `git grep -nE "McpRegistrar|register-mcp|buildMcp(Add|Remove)Args|mcpErrorTail" -- packages scripts ':!packages/core/src/distribution-hooks.ts'` prints nothing (T5 rewords the register-mcp precedent comment in distribution-hooks.ts ~:76); `bun run typecheck` exits 0; every edited test file passes via `bun run test:file`.
