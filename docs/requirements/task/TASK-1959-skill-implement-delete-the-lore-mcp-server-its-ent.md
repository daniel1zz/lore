---
id: TASK-1959
type: task
role: plan
title: "[Skill:implement] Delete the lore MCP server, its entry flag, SDK dependency and MCP-only tests"
status: archived
priority: critical
phase: "Phase 2: Delete the server"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1936, type: blocks}
  - {id: TASK-1940, type: blocks}
  - {id: TASK-1933, type: blocks}
  - {id: TASK-1957, type: blocks}
---
Estimate: L
Approach: delete packages/lore/src/adapters/mcp/ (whole dir incl. its CLAUDE.md); remove the `--mcp-server` branch of packages/lore/src/index.ts (~:6-31); remove `@modelcontextprotocol/sdk` from packages/lore/package.json (~:13) and run `bun install` to update bun.lock; remove App.forWriteContext from packages/lore/src/app.ts (~:695-701, :1817-1823; only MCP calls it — keep loadProjectConfig, evidence.ts:447 uses it) and its comments (including the one ~:678); narrow packages/lore/src/adapters/read-side-by-filters.ts (~:23 type → "cli", delete ~:41-50); delete scripts/bench/mcp-call-overhead.ts; fix comments in scripts/test-known-party-spawn.ts (~:89), scripts/check-no-timer-retry.ts (~:224); fix CLAUDE.md files (root CLAUDE.md ~:7,35 "What This Is" + "Gates run in the service layer, so CLI, MCP and HTTP" → CLI and HTTP, then `lore context refresh` regenerates the module index; packages/lore/src/adapters/cli/CLAUDE.md ~:63; packages/lore/src/service/CLAUDE.md ~:86; packages/lore/src/ai/CLAUDE.md ~:52; packages/lore/src/store/CLAUDE.md ~:32; packages/core/src/CLAUDE.md ~:52) and README.md (~:12,13,107,121). Read `lore governance claude-md` before editing CLAUDE.md. MCP-only test files are already deleted by T6a. Then make the write ban hold by construction (ADR decision 3, spec D2/D4): in packages/core/src/types.ts split CallerSurface into the read-side union (keeps "mcp") and an exported writable surface type without it; make `app.callerSurface` (app.ts), `runWithAuditSurface` (packages/lore/src/store/audit-surface.ts) and AI-default resolution (packages/lore/src/ai/resolve-ai.ts: its Record over surfaces and its doc examples) take the writable type; remove the `mcp` key and its built-in default from AiDefaultPerSurfaceSchema in packages/core/src/ai.ts.
Source: spec-remove-the-lore-mcp-server Scope/D1/D3.
Dimensions: D-FUNC, D-CODE, D-DOC
Scope-Alt: none
Covers: AC-RMCP-1, AC-RMCP-3, AC-RMCP-5, AC-RMCP-8

Scenarios:
- Given a stored telemetry row, a trace row and an audit row with surface "mcp" and a setup manifest with a kind "mcp" entry, When parsed with the current core schemas, Then each parses and keeps "mcp" (packages/core/tests/caller-surface-mcp-history-read.test.ts).
- Given the repo, When AC-RMCP-1's git grep runs, Then it prints nothing.
- Given the repo, When packages/lore/package.json and bun.lock are searched for @modelcontextprotocol, Then nothing, and `bun run build` exits 0.
- Given a throwaway corpus whose .lore/config.yaml sets ai.defaults.mcp, When `lore status` runs, Then exit exactly 4 and stderr names the file and the key mcp; without the key, exit 0 (packages/lore/tests/integration/config-ai-defaults-mcp-key-refused.bun.test.ts).
- Given packages/lore/tests/unit/types/surface-mcp-write-ban.test.ts passing "mcp" to app.callerSurface, runWithAuditSurface, AI-default resolution and the install-manifest entry writer, each under `// @ts-expect-error`, When `bun run typecheck` runs, Then it exits 0 (and turns red if any writer accepts "mcp").

Red-first: capture the failing AC-RMCP-3 and AC-RMCP-8 tests and the AC-RMCP-1 grep (red: lines found) before deleting, then capture the passes.

AC:
- Drop the MCP half (keep CLI/HTTP halves) of the shared tests in tests/unit/adapters/: evidence-completeness-guard (~:445-469), evidence-dropped-file-guard (~:334), foreign-corpus-write-adapters (~:260, :295), report-issue-required-flags (~:25), feedback-read-site-invariant.
- Delete AC-ND-8 in e2e/landing-from-git-facts-compiled (~:120/191; delete the file if that is its only case) and the MCP part of e2e/record-lock-compiled (~:91-196).
- Edit: unit/cli/write-commands-take-no-by.test.ts (~:73/83/101/123-135), integration/config-unparsable-loud (~:108), integration/migrate-schema-explicit (~:107), integration/dc2-store-selection (~:258-271), integration/cli-feed-task-start (~:42), e2e/libsql-lazy-load (~:797, asserts the MCP entry primes libsql), unit/flows/feed-flow-resume-closure (~:10 comment), unit/service/claude-md-eviction-floor (~:18 comment), scripts/tests/test-known-party-spawn.test.ts (~:93), scripts/tests/check-shipped-defaults.test.ts (~:667 comment). Keep unit/distribution/postinstall.test.ts unchanged (an absence guard; excluded from AC-RMCP-1).
- `lore verify plan-remove-the-lore-mcp-server --ac AC-RMCP-1`, `--ac AC-RMCP-3`, `--ac AC-RMCP-5`, `--ac AC-RMCP-8` pass from the worktree; `bun run typecheck` exits 0; `bun run test:changed main` exits 0.
- Do not merge until the orchestrator confirms Invariant I5 (lore-81) and that T7a is done.
