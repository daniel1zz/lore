---
id: BASE-086
type: baseline
role: intent
title: "Module card: mcp adapter"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-008, type: supersedes}
---
# Module card: mcp adapter

Source: `packages/lore/src/adapters/mcp/CLAUDE.md`.

- **Responsibility**: MCP stdio server (`lore --mcp-server`, `lore agent`) registering the `lore_*` tools and resources on `@modelcontextprotocol/sdk`'s `McpServer`.
- **Public surface**: `startMcpServer(app, getConfig?)`; tools named `lore_<verb>` mirroring the CLI; `CORPUS_SCHEMA_INFO` resource.
- **Dependencies**: `@lore/core`, services via the App, `../evidence-capture.ts` (shared with the CLI).
- **Invariants**:
  - Never throws across the MCP boundary: failures return `isError: true`.
  - 3-arg `server.tool(...)` registration then patched `inputSchema` (the 4-arg form OOMs tsc).
  - Callers pass `by` explicitly; no env/OS fallback.
  - `attestation` and `capture_source` are never caller inputs.
  - `lore_feed` dispatch derives from the shared `SPECIAL_FEED_CHECKPOINTS` descriptor.
