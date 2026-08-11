---
id: SPEC-011
type: spec
role: spec
title: "HTTP API Adapter"
status: approved
priority: high
created: 2026-06-08
updated: 2026-07-14
tags: [http, api, adapter, phase-2]
parent: PRD-001
links:
  - {id: SPEC-001, type: implements}
  - {id: SPEC-010, type: relates-to}
  - {id: SPEC-008, type: relates-to}
---
# SPEC-011: HTTP API Adapter

## 1. Purpose

HTTP API adapter on the same service layer. Serves corpus data as structured JSON for web clients (Phase 3) and third-party integrations. Also hosts Better-Auth endpoints and MCP Streamable HTTP transport.

## 2. Tech Stack

- **Server**: `Bun.serve()` (built-in HTTP server, no Express/Fastify needed)
- **Routing**: lightweight router (Hono or manual pattern matching)
- **Auth**: Better-Auth middleware (bearer plugin)
- **Entry**: `lore serve` (starts HTTP + MCP HTTP on same port)

## 3. API Surface

All endpoints return JSON envelope: `{ ok: boolean, data?: T, error?: LoreError }`.

### 3.1 Document Endpoints

| Method | Path | Service Call | Auth |
|---|---|---|---|
| POST | `/api/docs` | `corpusService.create()` | Required |
| GET | `/api/docs/:idOrSlug` | `corpusService.get()` | Required |
| PATCH | `/api/docs/:idOrSlug` | `corpusService.set()` | Required |
| DELETE | `/api/docs/:idOrSlug` | `corpusService.delete()` | Required |
| GET | `/api/docs` | `corpusService.list()` | Required |
| GET | `/api/search` | `corpusService.search()` | Required |
| GET | `/api/tree` | `corpusService.tree()` | Required |
| GET | `/api/status` | `corpusService.status()` | Required |

### 3.2 Link Endpoints

| Method | Path | Service Call | Auth |
|---|---|---|---|
| POST | `/api/links` | `corpusService.link()` | Required |
| DELETE | `/api/links/:from/:to` | `corpusService.unlink()` | Required |

### 3.3 Review Endpoints

| Method | Path | Service Call | Auth |
|---|---|---|---|
| GET | `/api/review/pending` | `reviewService.pending()` | Required |
| POST | `/api/review/:idOrSlug/approve` | `reviewService.approve()` | Required |
| POST | `/api/review/:idOrSlug/reject` | `reviewService.reject()` | Required |

### 3.4 Version Endpoints

| Method | Path | Service Call | Auth |
|---|---|---|---|
| GET | `/api/docs/:idOrSlug/log` | `versionService.log()` | Required |
| GET | `/api/docs/:idOrSlug/diff` | `versionService.diff()` | Required |
| POST | `/api/docs/:idOrSlug/restore` | `versionService.restore()` | Required |

### 3.5 Auth Endpoints (Better-Auth hosted)

| Path | Description |
|---|---|
| `/auth/*` | Better-Auth handler (device auth, token, API keys) |

### 3.6 MCP Streamable HTTP

| Path | Description |
|---|---|
| `/mcp` | MCP Streamable HTTP transport endpoint |

## 4. Implementation Pattern

```typescript
// src/adapters/http/index.ts
import { createApp } from '../../app'

export function startHttpServer(config: HttpConfig) {
  const app = createApp(config.dbPath)

  Bun.serve({
    port: config.port ?? 3456,
    async fetch(req) {
      const url = new URL(req.url)

      // Auth routes
      if (url.pathname.startsWith('/auth/')) return authHandler(req)

      // MCP Streamable HTTP
      if (url.pathname === '/mcp') return mcpHandler(req, app)

      // API routes (require auth)
      const actor = await authenticate(req)
      if (!actor) return json({ ok: false, error: 'Unauthorized' }, 401)

      // Route dispatch
      return routeApi(req, url, app, actor)
    }
  })
}
```

## 5. Response Format

```typescript
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "DOC_NOT_FOUND", "id": "spec-xyz" } }
```

HTTP status codes:
| LoreError | HTTP Status |
|---|---|
| DOC_NOT_FOUND | 404 |
| VALIDATION_ERROR, SCHEMA_VIOLATION | 422 |
| STALE_VERSION | 409 |
| DELETE_REQUIRES_CONFIRM | 400 |
| STORE_ERROR | 500 |
| Unauthorized | 401 |

## 6. CLI Command

```
$ lore serve
Lore server running at http://localhost:3456
  API:  http://localhost:3456/api/
  Auth: http://localhost:3456/auth/
  MCP:  http://localhost:3456/mcp
```

Options: `--port <number>`, `--host <string>`

## 7. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| Server running | GET /api/docs with valid bearer token | Returns doc list JSON |
| Server running | GET /api/docs/spec-auth with valid token | Returns doc + navigation JSON |
| Server running | POST /api/docs with invalid token | 401 Unauthorized |
| Server running | GET /api/search?q=auth | Returns search results JSON |
| Server running | POST /mcp (MCP Streamable HTTP) | MCP tool call works |
| Server running | GET /auth/device (browser) | Shows device auth verification page |

## Code anchors

- packages/lore/src/adapters/http/
