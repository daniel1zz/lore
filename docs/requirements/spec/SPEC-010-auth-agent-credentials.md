---
id: SPEC-010
type: spec
role: spec
title: "Auth & Agent Credentials"
status: approved
priority: critical
created: 2026-06-08
updated: 2026-07-02
tags: [auth, credentials, better-auth, agent-identity, phase-2]
parent: PRD-001
links:
  - {id: SPEC-008, type: relates-to}
  - {id: SPEC-011, type: relates-to}
---
# SPEC-010: Auth & Agent Credentials

## 1. Purpose

Multi-user authentication and per-agent credential management. Enables team members and AI agents to access shared corpus with verified identity.

## 2. Tech Stack

- **Package**: `better-auth` + `@better-auth/api-key` + `@better-auth/bearer`
- **Storage**: Same SQLite database (`.lore/lore.db`) via `bun:sqlite` adapter
- **CLI flow**: Device Authorization (RFC 8628) via `@better-auth/device-auth` plugin

## 3. Auth Flows

### 3.1 Human Login (`lore login`)

Device Authorization flow (RFC 8628):
1. CLI calls auth server → gets device_code + user_code + verification_uri
2. CLI opens browser to verification_uri, displays user_code
3. CLI polls auth server until user completes browser flow
4. Auth server returns access_token + refresh_token
5. CLI stores tokens in `~/.config/lore/credentials.json`

```
$ lore login
Open browser: https://localhost:3456/auth/device
Enter code: ABCD-1234
Waiting for authorization... ✓
Logged in as owner@example.com
```

### 3.2 Agent API Key

Issued by admin (human) for each AI agent:

```
$ lore agent create --name "claude-code-prod"
Agent created:
  Name:    claude-code-prod
  API Key: lore_ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  
Configure in .mcp.json:
  "env": { "LORE_API_KEY": "lore_ak_xxx..." }
```

API key features (via `@better-auth/api-key`):
- CRUD: create, list, revoke
- Rate limiting: configurable per key (default: 60 writes/min per NFR-14)
- Expiry: optional TTL
- Scoping: metadata tags (agent name, owner)

### 3.3 HTTP Bearer Token

For HTTP API and Streamable HTTP MCP:
- Human: access_token from login flow
- Agent: API key in `Authorization: Bearer lore_ak_xxx...` header
- Validated on every request via Better-Auth bearer plugin

## 4. Auth Server

Better-Auth requires an HTTP server for auth endpoints. Lore's HTTP API server (SPEC-011) hosts these:

```
POST /auth/device                  # Device auth initiation
GET  /auth/device/verify           # Browser verification page
POST /auth/device/token            # Token polling
POST /auth/api-key/create          # Create API key
POST /auth/api-key/revoke          # Revoke API key
GET  /auth/api-key/list            # List API keys
```

These are mounted as a sub-router on Lore's HTTP server.

## 5. Identity Model

```typescript
interface LoreUser {
  id: string                    // Better-Auth user ID
  name: string
  email: string
  role: 'admin' | 'member'     // flat trust: all admins for now
}

interface LoreAgent {
  id: string                    // API key ID
  name: string                  // e.g., "claude-code-prod"
  owner_id: string              // User who created this agent
  api_key_hash: string          // bcrypt hash, never stored plain
  rate_limit: number            // writes per minute
  created_at: string
  revoked_at: string | null
}

type LoreActor = 
  | { type: 'user'; user: LoreUser }
  | { type: 'agent'; agent: LoreAgent }
```

### 5.1 Actor Resolution

Every service call includes an actor context:
```typescript
interface ActorContext {
  actor: LoreActor
  session_id: string
}
```

Adapters extract actor from:
- CLI: from stored credentials (`~/.config/lore/credentials.json`)
- MCP stdio: from environment variable `LORE_API_KEY` (agent)
- MCP HTTP: from Bearer token header
- HTTP API: from Bearer token or session cookie

## 6. CLI Commands

| Command | Description |
|---|---|
| `lore login` | Device auth flow for human users |
| `lore logout` | Clear stored credentials |
| `lore whoami` | Show current identity |
| `lore agent create --name <name>` | Create API key for agent |
| `lore agent list` | List all agents and their status |
| `lore agent revoke <name>` | Revoke agent's API key |
| `lore agent rotate <name>` | Generate new key, invalidate old |

## 7. Offline Auth (per NFR-10)

- Access tokens have max TTL of 7 days for offline use
- On reconnect: validate token with server before pushing changes
- Revoked tokens rejected on reconnect — local changes discarded or queued for conflict resolution

## 8. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| No credentials stored | `lore login` | Opens browser, completes device auth, stores token |
| Valid credentials | `lore whoami` | Shows user name + email |
| Admin user | `lore agent create --name claude-code` | API key printed, stored in Better-Auth DB |
| Agent with API key | MCP request with `LORE_API_KEY` | Request authenticated, actor.type = 'agent' |
| Revoked API key | Agent makes request | 401 Unauthorized |
| Offline (no server) | CLI read with valid cached token (< 7 days) | Works locally |
| Offline (no server) | CLI read with expired token (> 7 days) | Error: re-authentication required |
