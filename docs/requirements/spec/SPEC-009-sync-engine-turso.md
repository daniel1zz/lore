---
id: SPEC-009
type: spec
role: spec
title: "Sync Engine (Turso)"
status: deprecated
priority: critical
created: 2026-06-08
updated: 2026-10-10
tags: [sync, turso, libsql, cloud, phase-2]
---
# SPEC-009: Sync Engine (Turso Embedded Replicas)

## 1. Purpose

Cloud sync via Turso embedded replicas. Local SQLite file remains the primary read path (microsecond latency). Writes forward to remote Turso database. Enables multi-user, multi-device shared corpus.

## 2. Tech Stack

- **Package**: `@libsql/client` v0.17.3
- **Architecture**: Embedded replica — local `.lore/lore.db` syncs with remote Turso database
- **Sync model**: Server-authoritative pull. Reads from local, writes to remote, auto-sync pulls changes.
- **Pricing**: Turso free tier (5GB, 100 DBs, 500M reads/mo) — sufficient for internal team

## 3. Store Layer Changes

### 3.1 TursoStore

New store implementation that wraps `@libsql/client` instead of `bun:sqlite`.

```typescript
import { createClient, type Client } from '@libsql/client'

export class TursoStore implements StoreInterface {
  private client: Client

  constructor(config: TursoConfig) {
    this.client = createClient({
      url: `file:${config.localPath}`,        // .lore/lore.db
      syncUrl: config.remoteUrl,               // libsql://lore-xxx.turso.io
      authToken: config.authToken,
      syncInterval: 60,                        // auto-sync every 60s (verify unit)
      readYourWrites: true,
    })
  }

  async sync(): Promise<SyncResult> {
    const result = await this.client.sync()
    return { frameNo: result.frame_no, framesSynced: result.frames_synced }
  }

  // All StoreInterface methods delegate to this.client.execute()
  // Note: @libsql/client is ASYNC (unlike bun:sqlite which is sync)
}
```

### 3.2 Async StoreInterface

**Breaking change**: `@libsql/client` is async. Current `StoreInterface` is sync (for `bun:sqlite`). Options:

**Option A (recommended)**: Make `StoreInterface` async (`Promise<Result<T>>`). Update all services to `await` store calls. SQLiteStore wraps sync `bun:sqlite` in resolved promises.

**Option B**: Keep sync `StoreInterface` for local, add separate `AsyncStoreInterface` for Turso. Services accept either. More complex, duplicated interfaces.

→ **Go with Option A**. The async overhead for local SQLite is negligible, and it unifies the interface.

### 3.3 Migration from Local-Only

```bash
# User has existing .lore/lore.db from Phase 1
# Setup remote sync:
lore sync setup                    # interactive: Turso URL + token
lore sync push                     # upload local DB to Turso
lore sync status                   # show sync state
```

Behind the scenes:
1. `turso db create lore-db --from-file .lore/lore.db` (or API equivalent)
2. Store Turso URL + token in `.lore/config.yaml`
3. Re-create client as embedded replica pointing to remote
4. Subsequent reads are local, writes go to remote

## 4. Conflict Resolution

Per PRD §7.5: optimistic locking with document-level version vectors.

### 4.1 Write Flow

```
Agent A writes doc X (version=3)
  → TursoStore.update(id, {content: "new", version: 4})
  → @libsql/client forwards write to remote Turso
  → Remote checks: current version = 3? → YES → accept, version=4
  → Local replica auto-syncs → sees version=4

Agent B writes doc X (also expects version=3)
  → Remote checks: current version = 4 (Agent A already wrote) → REJECT
  → TursoStore returns STALE_VERSION error
  → Service layer returns error to adapter
  → Agent B must re-read, rebase, retry
```

### 4.2 Implementation

Add version check to UPDATE SQL:
```sql
UPDATE docs SET content=?, version=?, updated_at=?
WHERE id=? AND version=?
-- If 0 rows affected → STALE_VERSION
```

This works for both SQLiteStore (local) and TursoStore (remote) — same SQL, different transport.

## 5. New CLI Commands

| Command | Description |
|---|---|
| `lore sync setup` | Configure remote Turso connection |
| `lore sync push` | Upload local DB to Turso (first-time) |
| `lore sync pull` | Manual sync trigger |
| `lore sync status` | Show sync state (last sync, frames, remote URL) |

## 6. Configuration

```yaml
# .lore/config.yaml (after sync setup)
project:
  name: "lore"
  author: "owner"
sync:
  remote_url: "libsql://lore-db-xxx.turso.io"
  auth_token: "${LORE_SYNC_TOKEN}"  # env var reference
  interval: 60                       # auto-sync seconds
  enabled: true
```

## 7. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| Local-only corpus with 8 docs | `lore sync setup` + `lore sync push` | All 8 docs visible on Turso dashboard |
| Turso sync enabled | Agent A creates doc on machine 1 | Machine 2 sees doc after sync interval |
| Two agents write same doc | Second write with stale version | STALE_VERSION error, not silent overwrite |
| Turso unreachable | CLI reads local corpus | Reads work offline; writes return STORE_ERROR (fail loud, no queue — D-005) |
| `lore sync status` | | Shows last sync time, frames synced, remote URL |

## Code anchors

- packages/lore/src/store/turso-store.ts
