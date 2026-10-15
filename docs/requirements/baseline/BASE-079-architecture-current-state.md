---
id: BASE-079
type: baseline
role: intent
title: "Architecture: current state"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-095
---
# Current state

What the code is today. One module card per module doc (`packages/*/CLAUDE.md`, `packages/lore/src/*/CLAUDE.md`); the cards summarise responsibility, public surface, dependencies and invariants and point at the module doc for detail.

## Module map

| Card | Module | Depends on |
|---|---|---|
| core | `packages/core/src` | nothing (leaf) |
| store | `packages/lore/src/store` | core |
| service | `packages/lore/src/service` | core, store (via `StoreInterface`) |
| ai | `packages/lore/src/ai` | core |
| cli | `packages/lore/src/adapters/cli` | core, service (via App) |
| mcp | `packages/lore/src/adapters/mcp` | core, service (via App) |
| http | `packages/lore/src/adapters/http` | core, service, store (`bun:sqlite` for ApiKeyStore) |
| eval | `packages/lore/src/eval` | core, service (read-only) |
| dashboard | `packages/dashboard` | `@lore/core` only; talks to http over `/api/*` |

## Data flow

A write enters an adapter -> `app.<service>.<method>()` -> `GateEnforcer` checkpoints (service layer) -> `StoreInterface` CAS write (`expected_version`) -> version row + audit row (hash-chained). Reads resolve id/slug/prefix through `resolveDoc`; MDX placeholders are resolved adapter-side by `OutlineService`.

## Dashboard console and multi-project (no business branch)

The dashboard has no business branch; its console positioning, landed surfaces, packaged serving and multi-project mount are described on the dashboard module card (`baseline-module-card-dashboard`), which supersedes the two dashboard domain overviews.

## Known issues

Indexed in the debt section (AD-n entries).
