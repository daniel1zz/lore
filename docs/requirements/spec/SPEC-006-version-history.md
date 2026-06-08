---
id: SPEC-006
type: spec
role: spec
title: "Version History"
status: draft
priority: high
phase: P1
created: 2026-06-08
updated: 2026-06-08
tags: [versioning, history, rollback, audit, phase-1]
parent: PRD-001
links:
  - {id: SPEC-001, type: implements, note: "VersionService in service layer"}
  - {id: SPEC-002, type: consumes, note: "Uses VersionRecord from corpus schema"}
  - {id: SPEC-005, type: relates-to, note: "Review actions create version entries"}
---

# SPEC-006: Version History

## 1. Purpose

Define the document versioning and audit system. Every write creates a version snapshot. Users can view history, diff between versions, and restore previous versions. Essential for recovering from bad edits (human or agent).

## 2. Version Model

Each document has a monotonic version counter starting at 1. Every mutation (create, set, approve, reject, restore) creates a new version.

```typescript
interface VersionRecord {
  doc_id: DocId
  version: number           // 1, 2, 3, ...
  content: string           // Full content snapshot
  frontmatter: Record<string, unknown>  // Full frontmatter snapshot
  status: DocStatus         // Status at this version
  created_at: string        // ISO 8601
  created_by: string        // Who made this change
  action: VersionAction     // What triggered this version
  change_summary?: string   // Optional summary
}

type VersionAction =
  | 'create'     // Initial creation
  | 'update'     // Content or frontmatter change
  | 'approve'    // Status transition via review
  | 'reject'     // Status transition via review
  | 'restore'    // Rollback to previous version
  | 'delete'     // Soft-delete
```

## 3. VersionService Interface

```typescript
interface VersionService {
  log(docId: DocId, opts?: {
    limit?: number          // default: 20
    offset?: number
  }): Promise<VersionEntry[]>

  diff(docId: DocId, opts?: {
    from?: number           // version number. Default: version - 1
    to?: number             // version number. Default: latest
  }): Promise<Diff>

  restore(docId: DocId, version: number): Promise<Doc>
  // Creates a NEW version (version N+1) with content from the specified version.
  // Non-destructive: history is append-only.
}

interface VersionEntry {
  version: number
  action: VersionAction
  created_at: string
  created_by: string
  change_summary?: string
}

interface Diff {
  doc_id: DocId
  from_version: number
  to_version: number
  content_diff: string      // Unified diff format
  frontmatter_changes: FieldChange[]
  status_change?: { from: DocStatus, to: DocStatus }
}

interface FieldChange {
  field: string
  old_value: unknown
  new_value: unknown
}
```

## 4. Audit Log

Separate from version history. The audit log captures ALL operations, including reads of sensitive data (P2), auth events, and sync events.

```typescript
interface AuditEntry {
  timestamp: string
  actor: string             // user name or agent_id
  session_id: string
  action: string            // create, read, update, delete, approve, reject, restore, login, sync, ...
  doc_id?: DocId            // null for non-doc operations (login, sync)
  details?: Record<string, unknown>
}
```

**P1**: Audit captures writes + review actions.
**P2**: Extends to auth events, sync events, bulk reads.

**Storage**: Audit log stored in separate SQLite table (or separate DB file for P2 tamper-evidence).

## 5. Storage Considerations

### Version Snapshots

Full content snapshots per version. At 500 docs × average 10 versions × 5KB = ~25MB. Well within SQLite capacity.

> [TO BE DESIGNED] — Evaluate delta storage vs full snapshots for P2 (larger corpus, cloud sync bandwidth). P1 uses full snapshots for simplicity.

### Diff Algorithm

- Content diff: line-level unified diff (similar to `git diff`)
- Frontmatter diff: field-level comparison
- Library candidates: `diff` (npm), custom line diff, or `jsdiff`

## 6. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| Doc X created, then edited twice | `lore log X` | Shows 3 versions: v1 (create), v2 (update), v3 (update) with timestamps and actors |
| Doc X at v3 | `lore diff X` | Shows diff between v2 and v3 (default: last two) |
| Doc X at v3 | `lore diff X 1 3` | Shows diff between v1 and v3 |
| Doc X at v3 | `lore restore X 1` | New v4 created with v1's content. v1-v3 untouched. Doc status resets to draft |
| Doc X soft-deleted | `lore log X` | Still shows full history including delete action |
| `lore log` (no doc-id) | | Shows recent audit entries across all docs, newest first |
