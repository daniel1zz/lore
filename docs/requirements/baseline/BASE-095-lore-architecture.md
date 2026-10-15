---
id: BASE-095
type: baseline
role: intent
title: "Lore architecture"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Lore architecture

Technical current-state and target-state of lore, per `adr-the-product-is-a-baseline-tree-specs-are-implementations` decision 3. The business baseline tree (root `baseline-root`) says WHAT lore does; this tree says HOW it is built and which rules new code must follow. Technical structure (adapters, layering, schema, storage, sync, telemetry) lives here, never under a business leaf.

## System overview

- **One binary, `lore`** (`bun build --compile` -> `dist/lore`), entered at `packages/lore/src/index.ts`, which routes argv to one of three adapters:
  - **CLI** (citty, default) — `packages/lore/src/adapters/cli/`
  - **MCP stdio server** (`lore --mcp-server` / `lore agent`) — `packages/lore/src/adapters/mcp/`
  - **HTTP server** (`lore serve`, `lore dashboard`; Bun.serve + bearer/cookie auth + sync-push) — `packages/lore/src/adapters/http/`
- **Storage**: local SQLite via `bun:sqlite` by default; with `sync.enabled` a Turso embedded replica via `@libsql/client`.
- **Web UI**: `@lore/dashboard` (Vite + React), built into and served by the same binary.

## Layer stack (dependencies point down only)

| Layer | Path | Role |
|---|---|---|
| Adapters | `packages/lore/src/adapters/{cli,mcp,http}` | Parse input, call services through the App, render, map errors |
| Composition root | `packages/lore/src/app.ts` | `createApp(dbPath, config?)` wires store + services + gates |
| Services | `packages/lore/src/service/` | Business logic; every public method returns `Promise<Result<T, LoreError>>` |
| AI | `packages/lore/src/ai/` | Provider registry, judge prompt templates |
| Store | `packages/lore/src/store/` | Async `StoreInterface`; SQLite / Turso / InMemory |
| Core | `packages/core/src/` (`@lore/core`, `@lore/core/node`) | Types, errors, Zod schemas, lifecycle, config, telemetry |
| Eval | `packages/lore/src/eval/` | Read-only evaluation scenarios |

## Sections

- **current-state** — one card per module (the nine module CLAUDE.md files) plus the dashboard console narrative.
- **target-state** — where the structure is heading, including extension hooks.
- **standards** — four-part rules (AS-n) new code must follow.
- **adr** — index of the corpus ADRs.
- **debt** — the architecture-debt registry (AD-n), each entry naming its open issue.
