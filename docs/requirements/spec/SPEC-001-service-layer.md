---
id: SPEC-001
type: spec
role: spec
title: "Service Layer Architecture"
status: in-review
priority: critical
phase: P1
created: 2026-06-08
updated: 2026-06-08
tags: [architecture, service-layer, core, phase-1]
parent: PRD-001
links:
  - {id: SPEC-002, type: consumes, note: "Service layer operates on corpus schema types"}
  - {id: SPEC-003, type: consumed-by, note: "CLI adapter calls service layer"}
  - {id: SPEC-004, type: contains, note: "MDX resolution is a service layer capability"}
  - {id: SPEC-005, type: contains, note: "Review workflow is a service layer capability"}
  - {id: SPEC-006, type: contains, note: "Version history is a service layer capability"}
---

# SPEC-001: Service Layer Architecture

## 1. Purpose

Define the transport-agnostic service layer that contains **all** business logic for Lore. Adapters (CLI, MCP, HTTP, TUI) are thin I/O mappers that call service methods and format responses. Zero business logic lives in adapters.

## 2. Architecture Overview

```
Adapter Layer (thin)          Service Layer (all logic)       Storage Layer
┌──────────┐                 ┌────────────────────────┐      ┌──────────────┐
│ CLI      │──parse args──→  │ CorpusService          │      │              │
│ Adapter  │←─format text──  │   .create(input)       │─────→│ StoreInterface│
└──────────┘                 │   .get(query)          │      │   .insert()  │
┌──────────┐                 │   .set(id, patch)      │      │   .find()    │
│ MCP      │──parse JSON──→  │   .delete(id)          │←─────│   .update()  │
│ Adapter  │←─struct JSON──  │   .list(filters)       │      │   .delete()  │
└──────────┘                 │   .search(query)       │      └──────┬───────┘
┌──────────┐                 │   .tree(rootId)        │             │
│ HTTP     │──parse req───→  │   .link(from, to, type)│      ┌──────▼───────┐
│ Adapter  │←─JSON resp────  │   .unlink(from, to)    │      │ SQLiteStore  │
└──────────┘                 │                        │      │ (libSQL)     │
                             │ ReviewService          │      └──────────────┘
                             │   .pending(filters)    │      ┌──────────────┐
                             │   .approve(id)         │      │ TursoStore   │
                             │   .reject(id)          │      │ (P2 — sync)  │
                             │                        │      └──────────────┘
                             │ VersionService         │
                             │   .log(docId)          │
                             │   .diff(docId, v1, v2) │
                             │   .restore(docId, ver) │
                             │                        │
                             │ MigrationService       │
                             │   .migrateV1(path,opts)│
                             │                        │
                             │ OutlineService         │
                             │   .resolve(doc)        │
                             │   (MDX placeholder     │
                             │    resolution)         │
                             └────────────────────────┘
```

## 3. Service Interfaces

All service methods return `Result<T, LoreError>` (see §5). All write operations create a version snapshot (see SPEC-006). All write operations append an audit entry.

### 3.1 CorpusService

The primary service. CRUD + graph + search operations on the corpus. All methods return `Result<T, LoreError>`.

```typescript
interface CorpusService {
  // Resolve any input (slug or ULID) to a DocId
  resolve(input: string): Result<DocId, LoreError>

  // CRUD
  create(input: CreateDocInput): Result<DocRecord, LoreError>
  get(idOrSlug: string, opts?: GetOpts): Result<DocWithNavigation, LoreError>
  set(idOrSlug: string, patch: DocPatch): Result<DocRecord, LoreError>
  delete(idOrSlug: string, confirm: boolean): Result<{ id: DocId; recoverable_until: string }, LoreError>

  // Discovery
  list(filters: ListFilters): Result<{ docs: DocSummary[]; total: number }, LoreError>
  search(query: string, filters?: SearchFilters): Result<{ results: SearchHit[] }, LoreError>
  tree(rootIdOrSlug?: string, opts?: TreeOpts): Result<TreeNode, LoreError>

  // Graph
  link(fromIdOrSlug: string, toIdOrSlug: string, type: LinkType): Result<LinkRecord, LoreError>
  unlink(fromIdOrSlug: string, toIdOrSlug: string): Result<void, LoreError>

  // Status
  status(): Result<CorpusStatus, LoreError>
}

interface CreateDocInput {
  type: DocType
  title: string
  content?: string
  parent_id?: string     // slug or ULID
  tags?: string[]
  extra?: Record<string, unknown>
  priority?: Priority
}

interface DocPatch {
  title?: string
  content?: string
  status?: DocStatus
  priority?: Priority
  tags?: string[]
  extra?: Record<string, unknown>
  slug?: string          // rename slug
}

interface GetOpts {
  resolve_mdx?: boolean  // default: true. false = raw mode
}

interface DocWithNavigation {
  doc: DocRecord
  navigation: {
    parent: DocSummary | null
    siblings: DocSummary[]
    children: DocSummary[]
    related: Array<DocSummary & { link_type: LinkType }>
  }
  resolved_components?: ResolvedComponent[]  // if resolve_mdx=true
}

interface DocSummary {
  id: DocId
  slug: Slug
  type: DocType
  title: string
  status: DocStatus
  updated_at: string
}

interface TreeNode {
  doc: DocSummary
  children: TreeNode[]
}

interface CorpusStatus {
  total_docs: number
  by_type: Record<DocType, number>
  by_status: Record<DocStatus, number>
  last_updated: string
  db_size_bytes: number
}
```

### 3.2 ReviewService

Human review workflow for documents.

```typescript
interface ReviewService {
  pending(filters?: PendingFilters): Promise<PendingDoc[]>
  approve(id: DocId, reviewer?: string): Promise<Doc>
  reject(id: DocId, reason?: string): Promise<Doc>
}
```

### 3.3 VersionService

Document version history and rollback.

```typescript
interface VersionService {
  log(docId: DocId, opts?: LogOpts): Promise<VersionEntry[]>
  diff(docId: DocId, fromVer?: number, toVer?: number): Promise<Diff>
  restore(docId: DocId, version: number): Promise<Doc>
}
```

### 3.4 OutlineService

MDX placeholder resolution — the PRD-as-living-root engine.

```typescript
interface OutlineService {
  resolve(doc: Doc, opts?: ResolveOpts): Promise<ResolvedDoc>
  // ResolveOpts includes: expandDepth, surface (cli|web|mcp)
}
```

### 3.5 MigrationService

DocMan v1 import.

```typescript
interface MigrationService {
  analyze(sourcePath: string): Promise<MigrationReport>  // dry-run
  execute(sourcePath: string, opts: MigrateOpts): Promise<MigrationResult>
}
```

## 4. Storage Abstraction

```typescript
interface StoreInterface {
  // Document CRUD
  insert(doc: DocRecord): Promise<DocRecord>
  find(id: DocId): Promise<DocRecord | null>
  findMany(filters: StoreFilters): Promise<DocRecord[]>
  update(id: DocId, patch: Partial<DocRecord>): Promise<DocRecord>
  softDelete(id: DocId): Promise<void>

  // Links
  addLink(link: LinkRecord): Promise<LinkRecord>
  removeLink(fromId: DocId, toId: DocId): Promise<void>
  findLinks(docId: DocId, direction: 'in' | 'out' | 'both'): Promise<LinkRecord[]>

  // Search
  search(query: string, filters?: StoreFilters): Promise<SearchHit[]>

  // Versions
  insertVersion(version: VersionRecord): Promise<VersionRecord>
  findVersions(docId: DocId): Promise<VersionRecord[]>

  // Audit
  appendAuditEntry(entry: AuditEntry): Promise<void>
  queryAudit(filters: AuditFilters): Promise<AuditEntry[]>

  // Schema
  getSchema(): Promise<CorpusSchema>
}
```

**P1 implementation**: `SQLiteStore` using libSQL (bun:sqlite or better-sqlite3).

**P2 addition**: `TursoStore` extends `SQLiteStore` with embedded replica + sync. Same interface, added sync methods.

## 5. Error Model

Service layer uses typed Result objects (not thrown exceptions). Adapters pattern-match on error type to produce transport-specific responses.

```typescript
// All service methods return Result<T, LoreError>
type Result<T, E = LoreError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

// Error hierarchy — discriminated union
type LoreError =
  | { code: 'DOC_NOT_FOUND'; id: string; suggestions?: string[] }
  | { code: 'SLUG_NOT_FOUND'; slug: string; suggestions?: string[] }
  | { code: 'STALE_VERSION'; id: string; expected: number; actual: number }
  | { code: 'VALIDATION_ERROR'; field: string; message: string; value?: unknown }
  | { code: 'SCHEMA_VIOLATION'; type: string; missing: string[]; extra?: string[] }
  | { code: 'LINK_CYCLE'; path: string[] }
  | { code: 'DUPLICATE_SLUG'; slug: string; existing_id: string }
  | { code: 'DUPLICATE_LINK'; from: string; to: string; type: string }
  | { code: 'DELETE_REQUIRES_CONFIRM'; id: string }
  | { code: 'INVALID_TRANSITION'; from: string; to: string; allowed: string[] }
  | { code: 'PARENT_REQUIRED'; type: string }
  | { code: 'STORE_ERROR'; message: string; cause?: Error }
```

### 5.1 Error → Transport Mapping

| LoreError code | CLI exit code | CLI message | MCP error | HTTP status |
|---|---|---|---|---|
| DOC_NOT_FOUND | 3 | "Document not found: X. Did you mean Y?" | -32602 | 404 |
| STALE_VERSION | 5 | "Conflict: doc was updated. Pull latest with `lore get`" | -32409 | 409 |
| VALIDATION_ERROR | 4 | "Validation: {field} — {message}" | -32602 | 422 |
| SCHEMA_VIOLATION | 4 | "Missing required fields: {missing}" | -32602 | 422 |
| LINK_CYCLE | 4 | "Cycle detected: {path}" | -32602 | 422 |
| DELETE_REQUIRES_CONFIRM | 2 | "Add --confirm to delete" | -32602 | 400 |
| STORE_ERROR | 1 | "Internal error" (log details) | -32603 | 500 |

## 6. Dependency Injection

Constructor injection. No DI framework — plain TypeScript.

```typescript
// Composition root — wired once at startup
function createApp(config: LoreConfig): App {
  const store = new SQLiteStore(config.dbPath)
  const corpusService = new CorpusServiceImpl(store)
  const reviewService = new ReviewServiceImpl(store)
  const versionService = new VersionServiceImpl(store)
  const outlineService = new OutlineServiceImpl(store)
  const migrationService = new MigrationServiceImpl(store)

  return {
    corpusService,
    reviewService,
    versionService,
    outlineService,
    migrationService,
    store,  // exposed for adapter-level needs (e.g., close on shutdown)
  }
}

// CLI adapter receives App via factory
// Tests replace SQLiteStore with InMemoryStore — same interfaces, same behavior
function createTestApp(): App {
  const store = new InMemoryStore()
  // ... same wiring
}
```

### 6.1 Lifecycle

1. CLI entry point calls `createApp(config)`
2. Adapter dispatches command to appropriate service method
3. On exit: `store.close()` (flushes WAL, releases lock)

No singletons. No global state. Each invocation creates a fresh app instance.

### 6.2 Testing Seam

`InMemoryStore` implements `StoreInterface` with plain Maps/Arrays. Used for:
- Unit tests: fast, no file I/O
- Service layer tests: prove business logic is store-independent
- CLI adapter tests: prove adapter is service-independent (mock service)

## 7. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| Service layer initialized with SQLiteStore | CLI adapter calls `corpusService.create(validInput)` | Doc created in SQLite, version 1 recorded, audit entry written |
| Service layer initialized with in-memory store | Test calls same `corpusService.create(validInput)` | Identical behavior — proves adapter independence |
| CLI adapter receives `lore get SPEC-042` | Adapter parses args, calls `corpusService.get({id: "SPEC-042"})` | Adapter formats Doc + navigation into terminal output. Zero business logic in adapter |
| MCP adapter receives `lore_get({id: "SPEC-042"})` | Adapter parses JSON, calls same `corpusService.get({id: "SPEC-042"})` | Adapter formats Doc + navigation into MCP JSON response. Same service call, different output |
