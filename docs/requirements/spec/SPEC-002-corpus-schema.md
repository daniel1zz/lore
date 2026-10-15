---
id: SPEC-002
type: spec
role: spec
title: "Corpus Schema"
status: deprecated
priority: critical
created: 2026-06-08
updated: 2026-10-10
tags: [schema, data-model, corpus, phase-1]
links:
  - {id: SPEC-001, type: relates-to}
  - {id: SPEC-004, type: informs}
  - {id: SPEC-006, type: informs}
  - {id: SPEC-007, type: informs}
---
# SPEC-002: Corpus Schema

## 1. Purpose

Define the data model for Lore's document corpus: document types, fields, link types, lifecycle states, version model, and full-text search indexing. This schema is the foundation — every other spec depends on it.

## 2. Document Model

### 2.1 Core Record

```typescript
// Primary key: ULID (internal, sortable, collision-resistant)
// Human alias: slug (unique, CLI-friendly)
// Both are valid lookup keys: `lore get spec-auth-v2` or `lore get 01J5X7...`

type DocId = string   // ULID format: 01J5X7KZRF4AXRHX9WKE6DVP6P
type Slug = string    // format: {type}-{kebab-name} e.g. spec-auth-v2

type DocType = 'prd' | 'spec' | 'adr' | 'plan' | 'knowledge' | 'task'
type DocRole = 'intent' | 'spec' | 'decision' | 'plan' | 'knowledge'
type DocStatus = 'draft' | 'in-review' | 'approved' | 'active' | 'archived' | 'deprecated'
type Priority = 'critical' | 'high' | 'medium' | 'low'

interface DocRecord {
  id: DocId                    // ULID — internal primary key, auto-generated
  slug: Slug                   // Human-readable unique alias, auto-generated from type+title, editable
  type: DocType
  role: DocRole
  title: string
  status: DocStatus
  priority: Priority
  content: string              // Markdown/MDX body
  parent_id: DocId | null      // Tree parent (null = root). Required for spec, task
  created_at: string           // ISO 8601
  updated_at: string           // ISO 8601
  created_by: string           // User/agent identity
  version: number              // Monotonic version number (1, 2, 3...)
  deleted_at: string | null    // Soft-delete timestamp (null = active)
  tags: string[]               // Freeform tags
  extra: Record<string, unknown>  // Type-specific fields (see §2.3)
}
```

### 2.2 Document Types

| Type | Role | Required Fields | Description |
|---|---|---|---|
| `prd` | intent | title, status, priority | Product requirements — tree root |
| `spec` | spec | title, status, priority, parent_id | Feature specification — child of PRD or another spec |
| `adr` | decision | title, status, decision_status | Architecture decision record |
| `plan` | plan | title, status, phase | Implementation plan |
| `knowledge` | knowledge | title, sub_type | Ideation, retro, research, reference |
| `task` | plan | title, status, parent_plan_id | Executable work item within a plan |

### 2.3 Type-Specific Fields (stored in `extra`)

Each doc type has required and optional fields stored in the `extra` JSON column. Validated by service layer on create/update.

```typescript
// Validated at service layer — Zod schemas per type
interface PrdExtra {}  // No extra fields required

interface SpecExtra {}  // parent_id is on DocRecord itself

interface AdrExtra {
  decision_status: 'proposed' | 'accepted' | 'deprecated' | 'superseded'  // required
  superseded_by?: DocId    // set when decision_status = 'superseded'
}

interface PlanExtra {
  phase?: string           // e.g. "P1", "P2"
}

interface KnowledgeExtra {
  sub_type: 'ideation' | 'retro' | 'research' | 'reference'  // required
}

interface TaskExtra {
  plan_id: DocId           // required — which plan this task belongs to
  assignee?: string        // optional
  task_status?: 'todo' | 'in-progress' | 'done' | 'blocked'  // distinct from doc status
}
```

**Validation rules**:
- `adr` requires `decision_status` in extra
- `knowledge` requires `sub_type` in extra
- `task` requires `plan_id` in extra
- `spec` and `task` require `parent_id` on DocRecord (tree constraint)
- Unknown extra fields are preserved (forward-compatible) but not indexed

## 3. Document Lifecycle

```
         ┌──────────┐
         │  draft   │ ← default for all new docs
         └────┬─────┘
              │ lore approve (FR-15)
         ┌────▼─────┐
         │in-review  │ ← optional intermediate state
         └────┬─────┘
              │ lore approve
         ┌────▼─────┐
         │ approved  │
         └────┬─────┘
              │ (implicit — doc is actively referenced)
         ┌────▼─────┐
         │  active   │
         └────┬─────┘
              │
       ┌──────┴──────┐
  ┌────▼─────┐  ┌────▼──────┐
  │ archived │  │deprecated │
  └──────────┘  └───────────┘
```

- Agents write as `draft` by default
- Transition `draft → approved` requires human action (FR-15)
- `deprecated` = superseded by another doc (link type: `supersedes`)
- `archived` = no longer relevant but preserved for history

## 4. Link Model

### 4.1 Link Record

```typescript
type LinkType = 'parent' | 'implements' | 'informs' | 'supersedes' | 'relates-to' | 'blocks'

interface LinkRecord {
  from_id: DocId
  to_id: DocId
  link_type: LinkType
  created_at: string     // ISO 8601
  created_by: string
}
// PK: (from_id, to_id, link_type) — same pair can have multiple link types
```

### 4.2 Link Types

| Link Type | Semantics | Direction | Example |
|---|---|---|---|
| `parent` | Hierarchical containment (tree edge) | child → parent | SPEC-001 → PRD-001 |
| `implements` | Realization | spec → prd requirement | SPEC-003 implements PRD-001 FR-3 |
| `informs` | Advisory input | source → target | ADR-001 informs SPEC-001 |
| `supersedes` | Replacement | new → old | ADR-002 supersedes ADR-001 |
| `relates-to` | General association | bidirectional | KNOWLEDGE-001 relates-to SPEC-002 |
| `blocks` | Dependency | blocker → blocked | TASK-003 blocks TASK-007 |

### 4.3 Tree Constraint

- `parent` links form a **tree** (each doc has at most one parent)
- Other link types form a **graph** (many-to-many)
- No cycles in `parent` links (enforced at write time)
- `parent` links are the primary navigation axis; other links are cross-references

## 5. Version Model

Each write creates a new version snapshot.

```typescript
type VersionAction = 'create' | 'update' | 'approve' | 'reject' | 'restore' | 'delete'

interface VersionRecord {
  doc_id: DocId
  version: number              // Monotonic, starting at 1. PK: (doc_id, version)
  content: string              // Full content snapshot at this version
  extra: Record<string, unknown>  // Full extra fields snapshot
  status: DocStatus            // Status at this version
  title: string                // Title at this version
  action: VersionAction        // What triggered this version
  created_at: string           // ISO 8601
  created_by: string           // Who made this change
  change_summary?: string      // Optional human/AI-generated summary
}
```

- `lore log <doc-id>` returns version list
- `lore diff <doc-id>` shows diff between consecutive versions (or specified pair)
- `lore restore <doc-id> <version>` creates a NEW version with old content (non-destructive)

## 6. ID Scheme — Hybrid: ULID + Human Slug

**Decision**: Dual-key model. ULID as internal primary key, human slug as unique alias.

| Aspect | ULID (internal) | Slug (human) |
|---|---|---|
| Format | `01J5X7KZRF4AX...` (26 chars) | `spec-auth-v2` (type-kebab) |
| Generation | Auto on create | Auto from `{type}-{slugify(title)}`, editable |
| Uniqueness | Globally unique (guaranteed by ULID spec) | Unique within corpus (enforced by UNIQUE index) |
| Stability | Immutable — never changes | Mutable — user can rename via `lore set <id> --slug new-slug` |
| Used for | FK references, internal storage, version records, links | CLI input, display, human communication |
| Lookup | `WHERE id = ?` | `WHERE slug = ?` |

### 6.1 Slug Rules

- Format: `{type}-{kebab-case-name}` — e.g., `spec-auth-v2`, `adr-turso-selection`, `prd-lore`
- Auto-generated: `slugify(type + "-" + title)` → lowercase, non-alphanumeric → hyphens, deduplicate hyphens, trim to 64 chars
- Collision: if slug exists, append `-2`, `-3`, etc.
- Rename: `lore set <id> --slug new-slug` — updates slug, all references use ULID so no cascade needed
- Regex: `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`

### 6.2 Lookup Resolution

Service layer resolves any input to a DocId:
```typescript
// CorpusService.resolve(input) → DocId
// 1. If input matches ULID format → lookup by id
// 2. Else → lookup by slug
// 3. If not found → throw DocNotFound with suggestions (fuzzy match on slug)
```

### 6.3 v1 Migration

DocMan v1 uses ULID-only IDs. On migration:
- v1 ULID preserved as `id`
- Slug auto-generated from type + title
- v1 ID also stored in `extra.v1_original_id` for reference

## 7. SQLite Schema

### 7.1 Tables

```sql
-- Core document table
CREATE TABLE docs (
  id          TEXT PRIMARY KEY,            -- ULID
  slug        TEXT NOT NULL UNIQUE,        -- human-readable alias
  type        TEXT NOT NULL CHECK(type IN ('prd','spec','adr','plan','knowledge','task')),
  role        TEXT NOT NULL CHECK(role IN ('intent','spec','decision','plan','knowledge')),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft','in-review','approved','active','archived','deprecated')),
  priority    TEXT NOT NULL DEFAULT 'medium'
                CHECK(priority IN ('critical','high','medium','low')),
  content     TEXT NOT NULL DEFAULT '',     -- Markdown/MDX body
  parent_id   TEXT REFERENCES docs(id),    -- Tree parent (nullable for roots)
  extra       TEXT NOT NULL DEFAULT '{}',  -- JSON: type-specific fields
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  version     INTEGER NOT NULL DEFAULT 1,  -- Current version counter
  created_at  TEXT NOT NULL,               -- ISO 8601
  updated_at  TEXT NOT NULL,               -- ISO 8601
  created_by  TEXT NOT NULL,               -- User identity
  deleted_at  TEXT                          -- NULL = active, ISO 8601 = soft-deleted
);

-- Graph links between documents
CREATE TABLE links (
  from_id     TEXT NOT NULL REFERENCES docs(id),
  to_id       TEXT NOT NULL REFERENCES docs(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, link_type)
);

-- Version history (full snapshots)
CREATE TABLE versions (
  doc_id      TEXT NOT NULL REFERENCES docs(id),
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  extra       TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL,
  title       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK(action IN ('create','update','approve','reject','restore','delete')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  change_summary TEXT,
  PRIMARY KEY (doc_id, version)
);

-- Audit log (append-only)
CREATE TABLE audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL,
  actor       TEXT NOT NULL,              -- user name or agent_id
  session_id  TEXT NOT NULL,
  action      TEXT NOT NULL,
  doc_id      TEXT,                        -- NULL for non-doc ops
  details     TEXT DEFAULT '{}'            -- JSON
);

-- Full-text search
CREATE VIRTUAL TABLE docs_fts USING fts5(
  title,
  content,
  tags,
  content=docs,
  content_rowid=rowid
);
```

### 7.2 Indexes

```sql
CREATE INDEX idx_docs_type       ON docs(type)       WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_status     ON docs(status)     WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_parent     ON docs(parent_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_created_by ON docs(created_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_updated    ON docs(updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX idx_links_from      ON links(from_id);
CREATE INDEX idx_links_to        ON links(to_id);
CREATE INDEX idx_links_type      ON links(link_type);

CREATE INDEX idx_versions_doc    ON versions(doc_id, version DESC);

CREATE INDEX idx_audit_doc       ON audit(doc_id)   WHERE doc_id IS NOT NULL;
CREATE INDEX idx_audit_actor     ON audit(actor);
CREATE INDEX idx_audit_timestamp ON audit(timestamp DESC);
```

### 7.3 FTS5 Sync Triggers

```sql
-- Keep FTS index in sync with docs table
CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO docs_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
```

### 7.4 Schema Migration Strategy

- Schema version tracked in `PRAGMA user_version`
- Migration files: `src/store/migrations/001-initial.sql`, `002-xxx.sql`, ...
- On startup: compare `PRAGMA user_version` with latest migration → run pending migrations in order
- SQLite limitations: no `ALTER COLUMN`, no `DROP COLUMN` (before 3.35). Use `CREATE TABLE new → INSERT → DROP old → RENAME` pattern for breaking changes
- All migrations are forward-only (no rollback). Backup before migration

## 8. Full-Text Search (FTS5)

- Index: `title` + `content` + `tags`
- Query via `lore search <query>` → `StoreInterface.search()`
- Returns: `{id, title, snippet, score}` ranked by relevance
- Exclusion: encrypted docs (P2) excluded from FTS index with explicit trade-off note

## 9. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| Empty corpus | Create doc with type=spec, no parent_id | Validation error: spec requires parent_id |
| Doc SPEC-001 exists with version=3 | `set(SPEC-001, {content: "new"})` | Version 4 created; version 3 preserved in history |
| Doc A is parent of Doc B | Attempt to set A's parent to B | Rejected: cycle detected in parent tree |
| Doc X has status=draft | `approve(X)` by human | Status → approved, audit entry records reviewer |
| Doc Y has status=approved | `approve(Y)` again | No-op or error (already approved) |
| 500 docs in corpus | FTS5 search for "authentication" | Results in < 50ms p95, ranked by relevance |

## Code anchors

- packages/core/src/schemas.ts
