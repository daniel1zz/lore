---
id: ADR-065
type: adr
role: decision
title: "Retire the lore MCP server: the CLI and HTTP are the only surfaces"
status: approved
priority: medium
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PRD-001
links:
  - {id: TASK-702, type: supersedes}
  - {id: TASK-1932, type: supersedes}
  - {id: ADR-005, type: supersedes}
  - {id: ADR-025, type: supersedes}
---
## Context

lore ships three surfaces over one service layer: the citty CLI (default), an MCP stdio server (`lore --mcp-server`, `packages/lore/src/adapters/mcp/**`, 49 `lore_*` tools on `@modelcontextprotocol/sdk`), and the HTTP server (`lore serve`). `lore setup` registers the MCP server at user scope with `claude mcp add -s user lore -- <bin> --mcp-server` and records a synthetic `kind: "mcp"` entry in the install manifest.

Agents in this project drive lore through Bash + the CLI; the hooks, the run-identity injection, the evidence recorder and every skill already target the CLI. The MCP surface duplicates the CLI: ~40 MCP-only test files, a parity half in ~25 shared tests, a hook matcher (`mcp__.*lore_.*`), a context variable (`mcp_tool_count`), ~35 approved spec criteria and ~25 baseline rules exist only to keep the duplicate in step. Every new write rule has to be implemented and proven twice.

## Decision (decided by user, 2026-10-27)

1. Delete the lore MCP server: `lore --mcp-server`, `packages/lore/src/adapters/mcp/**`, the `@modelcontextprotocol/sdk` dependency, the MCP bench script, and every MCP-only test. The CLI and HTTP remain the only surfaces.
2. `lore setup` no longer registers a tool server (`register-mcp.ts`, `RealMcpRegistrar`, the `McpRegistrar` port and `SetupReceipt.mcp` are removed). Install and uninstall do NOT remove a registration an older lore made; users remove it by hand (`claude mcp remove -s user lore`).
3. Historical values stay readable, never written again, by construction: `CallerSurface` is split into the read-side union (still including `"mcp"`, so existing append-only audit and telemetry rows parse) and a writable surface type without `"mcp"` that every writer (`app.callerSurface`, `runWithAuditSurface`, AI-default resolution) takes; the setup manifest keeps parsing `kind: "mcp"` entries from older installs (`stripMcpEntries` stays) while the entry type the installer writes excludes it. The per-surface AI config key `mcp` is different: it is live user-edited configuration, not history, so it is removed from the strict schema; a config that still sets it fails to load with exit 4 naming the file and the key, and the user deletes the line by hand, as with the old registration in decision 2. `lore init` never wrote this key.
4. The one MCP-only capability a gate depends on gets a CLI flag before deletion: `lore set <plan> --requires-uat` merges `extra.requires_uat: true` into the plan's existing `extra` (other keys kept), and the plan-promote feeding pack names that command instead of the MCP `lore_set` tool. No general `--extra-json` is added.
5. `lore_batch`, `lore_schema` and `lore_context_bundle` are dropped without CLI replacements (run commands one by one; `lore get` already prints parent/siblings/related).
6. `lore --mcp-server` gets no special handling after removal.
7. In-flight MCP work is abandoned: the MCP-only tasks of plan #418 are invalidated and its unlanded MCP commits are dropped when that branch integrates; the decision-records plan owner corrects its own spec criteria (agreed cross-session, 2026-10-27).

## Consequences

- One surface fewer to keep at parity; gates and write rules are implemented and tested once in the service layer and exercised through the CLI (and HTTP where it has a route).
- Consumers with an old user-scope registration see a failing `lore` MCP server in Claude Code until they remove it by hand (accepted by the user). A config that hand-set the per-surface AI key `mcp` fails loud until that line is deleted.
- Corpus: the parent PRD's surface statements (Executive Summary architecture bullet, goal G4 'MCP adapter … delivered', the §4 architecture diagram, the §6 delivery state, NFR-12 `src/adapters/{cli,mcp,http}/`), SPEC-046's registration scope, ~35 spec criteria citing MCP tests or MCP parity, ADRs whose subject is MCP, and the baseline rules describing tool-server registration and the MCP route are superseded, amended or retired in the same initiative so the corpus does not describe a surface that no longer exists.

## Alternatives rejected

- Keep MCP but stop registering it by default: keeps the whole parity cost for an unused surface.
- Rewrite stored `"mcp"` values to another surface with a migration: rewrites historical audit data so it no longer shows its real origin (rejected by the user).
- Have `lore setup` remove old registrations automatically: rejected by the user.
