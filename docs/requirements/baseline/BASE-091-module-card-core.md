---
id: BASE-091
type: baseline
role: intent
title: "Module card: core"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-002, type: supersedes}
  - {id: SPEC-014, type: supersedes}
---
# Module card: core (`@lore/core`)

Source: `packages/core/src/CLAUDE.md`.

- **Responsibility**: types, `Result<T, LoreError>` error model, Zod schemas (SSOT for runtime shapes), lifecycle graph (`VALID_TRANSITIONS`), AC-as-code (`acceptance.ts`), baseline/rule schemas (`baseline.ts`), config, telemetry. Pure modules; IO only in the `*-node.ts` files.
- **Public surface**: the default barrel `@lore/core` (browser-safe) and the `@lore/core/node` subpath (`config-node.ts`, `telemetry-node.ts`, `slugify-node.ts`, `actor-resolution-node.ts`).
- **Dependencies**: none of the other `@lore/*` packages — the leaf of the graph. Used by every module of `@lore/lore` and by the dashboard (default barrel only).
- **Invariants**:
  - The default barrel never imports a Node builtin (oracle: `packages/lore/tests/unit/core/barrel-isolation.test.ts`).
  - `VALID_TRANSITIONS` is the only authority on status moves; the approved -> draft demotion has one implementation (`resolveStatusAfterContractEdit`).
  - One definition site per enum (`ORACLE_KINDS`, `DOC_TYPE_ROLE_MAP`); derived TS types come from `z.infer`.
  - Config stores env-var NAMES, never secrets; `resolveSyncCredentials` fails loud.
  - Telemetry never throws.
