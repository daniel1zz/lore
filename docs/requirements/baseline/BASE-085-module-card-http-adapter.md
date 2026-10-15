---
id: BASE-085
type: baseline
role: intent
title: "Module card: http adapter"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-011, type: supersedes}
---
# Module card: http adapter

Source: `packages/lore/src/adapters/http/CLAUDE.md`.

- **Responsibility**: Bun.serve HTTP API (`/health`, `/api/*`), dashboard static serving with one-time nonce bootstrap, and `sync-push` (logical replication of 5 tables to a remote libsql).
- **Public surface**: `startHttpServer(app, config)`; JSON envelope `{ok, value}` / `{ok:false, error:{code,message}}`; `pushToRemote`.
- **Dependencies**: `@lore/core`, services, store; `bun:sqlite` directly for `ApiKeyStore` and the machine-scope `dashboard-auth.db`.
- **Invariants**:
  - Every `/api/*` request needs an identity (cookie first, then bearer); `/health` is the only open route.
  - API keys stored as SHA-256; revoking a key kills its cookie sessions.
  - Dashboard writes check the Origin allowlist, built from the real ports.
  - Routes are thin pipes; body parsing via `parseJsonBody`; raw stacks never leak.
  - SPA fallback never shadows `/api/*`; `sync-push` is idempotent.
