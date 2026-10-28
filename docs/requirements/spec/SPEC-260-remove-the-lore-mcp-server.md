---
id: SPEC-260
type: spec
role: spec
title: "Remove the lore MCP server"
status: approved
priority: medium
created: 2026-10-27
updated: 2026-10-28
tags: []
links:
  - {id: ADR-065, type: implements}
  - {id: SPEC-149, type: supersedes}
---
## Overview/Goal

Remove the lore MCP server so the CLI and HTTP are lore's only surfaces, per `adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only` (decided by user, 2026-10-27). Done means: no shipped code starts, registers, tests or documents a lore MCP server; historical `"mcp"` values still parse; the one gate recovery that needed MCP (`extra.requires_uat` on a plan) has a CLI path; the corpus (baseline rules, leaf bodies, spec criteria, ADRs) no longer describes a lore MCP route once this spec and the two pending rule changes named in D7 have landed.

## Scope

In:
- Delete `packages/lore/src/adapters/mcp/**`, the `--mcp-server` branch of `packages/lore/src/index.ts`, `@modelcontextprotocol/sdk`, `scripts/bench/mcp-call-overhead.ts`, `App.forWriteContext` (only MCP calls it), the MCP half of `read-side-by-filters.ts`, every MCP-only test file, and the MCP half of shared parity tests.
- `lore setup`: remove `register-mcp.ts`, `RealMcpRegistrar`, the `McpRegistrar` port, `SetupReceipt.mcp`, the MCP exit-code path and render lines. A failed install no longer carries a previous `kind: "mcp"` manifest entry forward. `stripMcpEntries` stays (old manifests).
- Remove the `mcp__.*lore_.*` PreToolUse matcher (`distribution-hooks.ts`), the MCP branch of `assets/hooks/pre-tool-harness-run.mjs`, `rewriteMcpInput`, the MCP branch of `lore run`.
- Retire the `mcp_tool_count` context variable; drop `"mcp"` from `lore status`'s surface loop; reword messages, comments, skills (`assets/skills/**` references to `lore_*` MCP tools only), CLAUDE.md files and README that name the lore MCP server.
- Add `lore set <plan> --requires-uat` and point the plan-promote feeding pack at it.
- Split `CallerSurface` into the read-side union (keeps `"mcp"`) and a writable surface type without it, taken by every writer (`app.callerSurface`, `runWithAuditSurface`, AI-default resolution); the install-manifest entry type the installer writes excludes `kind: "mcp"`. Remove the per-surface AI config key `mcp` from the strict `AiDefaultPerSurfaceSchema` (packages/core/src/ai.ts) and its built-in default.
- Corpus: rule change set below; supersede or amend spec criteria and ADRs that require MCP; retire the mcp module card.

Out:
- Mentions of OTHER MCP servers (context7, serena, deepwiki, sequential-thinking) in skills.
- Removing an existing user-scope `claude mcp` registration made by an older lore (users do it by hand).
- Rewriting stored `"mcp"` values; the read-side `CallerSurface` union, the telemetry/trace zod enums and setup-manifest `kind: "mcp"` stay readable. (The per-surface AI config key is NOT kept: it is live configuration, see D4.)
- `lore_batch`, `lore_schema`, `lore_context_bundle` get no CLI replacement. `lore --mcp-server` gets no special handling.
- `.claude/worktrees/**`, archived/deprecated docs and retros (historical records).
- Special handling of a `mcp__.*lore_.*` PreToolUse entry that an older install wrote into a user's settings file: none is added. Measured 2026-10-27 (T5, `mergeSettings`): setup convergence already removes it, because it runs the same pre-tool-harness-run command as the Bash entry and convergence replaces every entry with that command; an entry whose command string differs (another hooks directory) is left as-is and is inert, since no lore tool server exists to match it.

## Design

- D1 Order: `--requires-uat`, setup, parity-test decoupling, skills/context-variable, message and comment retirement, and hook-matcher removal land before the server is deleted (each removes an import of `adapters/mcp` or a runtime dependency on `--mcp-server`); MCP-only tests are deleted only after the criteria that run them are superseded.
- D2 Write ban, read compat, by construction: writers (`app.callerSurface`, `runWithAuditSurface`, AI-default resolution, the install-manifest entry writer) take a writable type without `"mcp"`, so a write of `"mcp"` does not typecheck; the read-side `CallerSurface` union, the telemetry/trace enums and the parsed manifest type keep it for stored rows and old manifests. AC-RMCP-3 proves both halves: a parse test for the read half, and a type-level test that passes `"mcp"` to each writer under `// @ts-expect-error` for the write half.
- D3 `--requires-uat` on `lore set`: reads the doc's current `extra`, merges `{requires_uat: true}`, writes the whole object through the existing `corpusService.set` path (so gates and demotion apply as for any set); refused with exit 2 on a non-plan doc (BR-1486).
- D4 `lore status --json` reports AI defaults for cli, agent, http_cookie and http_token only (BR-1016 as modified). The per-surface AI config key `mcp` is removed from the strict schema: a config that still sets `ai.defaults.mcp` fails to load with exit 4 naming the file and the key (the existing unparsable-config path), and the user deletes the line by hand; `lore init` never wrote it (AC-RMCP-8).
- D5 Rule changes and their proof: BR-492, BR-629, BR-703, BR-747, BR-982, BR-1098, BR-1224 and BR-1340 change ONLY by dropping the agent-tool (MCP) route from their text; the rest of each rule is unchanged and stays proven by its existing citing criteria. What this spec must prove for them is that the route no longer exists, which is AC-RMCP-1, so AC-RMCP-1 cites them. BR-814/815/816/826/844 are proven by AC-RMCP-2, BR-1016 by AC-RMCP-7, new BR-1485 by AC-RMCP-3 (read and write halves), new BR-1486 by AC-RMCP-4. Retired rules (BR-1034, 1093, 1227, 1228, 1230, 1231, 1242, 601) need no proof. AC-RMCP-6 cites BR-1218, whose pending modification in spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and keeps "a payload it cannot read is passed through unchanged".
- D6 Architecture standards: AS-6/8/9/19 and AD-11 cannot join a change set (BR-n only); they are edited with `lore rule set` after the server is deleted, with the statements fixed in the plan.
- D7 Rules another unlanded spec already changes: BR-1351's pending modification in spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and already omits the MCP sentence (checked 2026-10-27), so its end state is right and no edit is needed. BR-569's pending modification in spec-defect-clusters-round-2-part-a-sessions-seats-setup-init still says "(command line, agent tools, web)"; it is corrected in that spec's change set (audited `--correction`) to "(command line, web)". Both end states are therefore designed here; only their landing order differs.
- D8 Corpus end state (baseline rule text and leaf bodies name no lore MCP route) is checked on main by the plan's verification task with `bun run mirror:export` and a git grep over docs/requirements/baseline, not by a criterion of this spec: every criterion must cite a rule (BR-1007), the only rule about the exported mirror (BR-1340) is changed here, and a criterion citing a changed rule must pass BEFORE `lore rule apply`, while this check can pass only AFTER it.

## Acceptance Criteria

Structured criteria are declared with `lore ac add` (AC-RMCP-1 … AC-RMCP-8).


## Acceptance Criteria (structured)

- [⚑] [script] AC-RMCP-1: Given the repo after the removal, when git grep searches packages/, scripts/, assets/, CLAUDE.md, README.md and vitest.node-files.ts (fixtures, the legacy-matcher roster test and the postinstall absence guard excluded) for the --mcp-server entry flag, the adapters/mcp path, the SDK, the registrar, mcp_tool_count, rewriteMcpInput, startMcpServer, forWriteContext or the mcp__.*lore_ hook matcher, then it finds no line (grep exit 1) and the command prints the PASS line. Other MCP servers named in skills are not matched.
  script: other — ! git grep -nE -- '--mcp-server|adapters/mcp|modelcontextprotocol|McpRegistrar|register-mcp|buildMcp(Add|Remove)Args|mcp_tool_count|rewriteMcpInput|startMcpServer|forWriteContext|mcp__\.\*lore_' -- packages scripts assets CLAUDE.md README.md vitest.node-files.ts ':!packages/lore/tests/fixtures/**' ':!packages/lore/tests/integration/cli/setup-turn-end-review-roster.test.ts' ':!packages/lore/tests/unit/distribution/postinstall.test.ts' && echo 'AC-RMCP-1 PASS: no lore MCP route remains'
  other_command=3
- [⚑] [script] AC-RMCP-2: Given a throwaway HOME and project with a fake claude executable on PATH that logs its argv and a settings file holding an unrelated user setting and hook, when lore setup previews (--dry-run), installs, re-installs unchanged and globally uninstalls, then every run exits exactly 0, the fake claude log contains no 'mcp' argv, the preview writes no file, the install keeps the unrelated setting and hook byte-identical, the manifest holds no kind 'mcp' entry, the --json receipt has no 'mcp' key, and the unchanged re-install writes no file; given a pre-existing manifest with an 'mcp:lore' entry, an install exits 0 without calling claude and writes a manifest without the entry, an install that fails part-way also writes no 'mcp' entry, and a global uninstall over such a manifest exits 0 without calling claude.
  script: test — bun run test:file packages/lore/tests/integration/cli/setup-registers-no-tool-server.bun.test.ts && echo 'AC-RMCP-2 PASS: setup neither registers nor removes a tool server'
  other_command=2
- [⚑] [script] AC-RMCP-3: Given stored telemetry, trace and audit rows and a setup manifest whose surface or kind is 'mcp', when they are parsed with the current core schemas, then each parses and keeps 'mcp' (read half); and given a type-level test that passes 'mcp' to every writer (app.callerSurface, runWithAuditSurface, AI-default resolution, the install-manifest entry writer) under // @ts-expect-error, when bun run typecheck runs, then it exits 0, so each writer refuses 'mcp' at compile time (write half: if any writer accepted 'mcp' the unused @ts-expect-error would fail typecheck).
  script: test — bun run typecheck && bun run test:file packages/core/tests/caller-surface-mcp-history-read.test.ts packages/lore/tests/unit/types/surface-mcp-write-ban.test.ts && echo 'AC-RMCP-3 PASS: historical mcp values read back and no writer accepts mcp'
  other_command=1
- [⚑] [script] AC-RMCP-4: Given a throwaway corpus with a plan whose extra holds phases, when lore set <plan> --requires-uat runs, then it exits 0, extra.requires_uat is true and extra.phases is byte-identical; when run on a task it exits exactly 2, names --requires-uat and the task's version is unchanged (nothing written); and the plan-promote feeding pack for a plan lacking requires_uat names 'lore set <plan> --requires-uat' and does not contain 'lore_set'.
  script: test — bun run test:file packages/lore/tests/integration/cli/set-requires-uat.bun.test.ts && echo 'AC-RMCP-4 PASS: requires_uat has a CLI path and the feeding pack names it'
  other_command=1
- [⚑] [script] AC-RMCP-5: Given the repo after the removal, when bun.lock and packages/lore/package.json are searched for @modelcontextprotocol and the binary is built, then neither file names the SDK and bun run build exits 0.
  script: build — ! grep -q '@modelcontextprotocol' packages/lore/package.json bun.lock && bun run build && echo 'AC-RMCP-5 PASS: SDK dependency removed and dist/lore builds'
- [⚑] [script] AC-RMCP-6: Given the shipped distribution hooks, when the PreToolUse entries for pre-tool-harness-run are listed, then no matcher names mcp__ and the hook script rewrites only Bash tool input (an mcp__lore__lore_get input passes through unchanged).
  script: test — bun run test:file packages/lore/tests/unit/core/distribution-hooks.test.ts packages/lore/tests/unit/hooks/pre-tool-harness-run-hook.test.ts -t 'AC-RMCP-6' && echo 'AC-RMCP-6 PASS: no lore MCP hook matcher ships'
  other_command=3
- [·] [script] AC-RMCP-7: Given a throwaway corpus, when lore status --json runs, then its AI-default report lists the surfaces cli, agent, http_cookie and http_token and has no 'mcp' entry, and the command exits exactly 0.
  script: test — bun run test:file packages/lore/tests/integration/cli/status-ai-defaults-surfaces.bun.test.ts && echo 'AC-RMCP-7 PASS: lore status reports no mcp surface'
  other_command=2
- [⚑] [script] AC-RMCP-8: Given a throwaway corpus whose .lore/config.yaml sets ai.defaults.mcp, when lore status runs, then it exits exactly 4 and stderr names the config file and the key mcp; given the same config without that key, lore status exits 0.
  script: test — bun run test:file packages/lore/tests/integration/config-ai-defaults-mcp-key-refused.bun.test.ts && echo 'AC-RMCP-8 PASS: a config still setting ai.defaults.mcp fails loud naming the key'
  other_command=1

## Code anchors

- packages/lore/src/adapters/cli/commands/set.ts
- packages/lore/src/service/setup-service.ts
- packages/core/src/setup-manifest.ts
- packages/core/src/distribution-hooks.ts
- packages/core/src/types.ts#WritableCallerSurface
- packages/core/src/ai.ts
- packages/lore/src/index.ts
- assets/hooks/pre-tool-harness-run.mjs
