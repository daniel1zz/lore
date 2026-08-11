---
id: SPEC-005
type: spec
role: spec
title: "Review Workflow"
status: approved
priority: high
created: 2026-06-08
updated: 2026-07-14
tags: [review, workflow, human-in-the-loop, phase-1]
parent: PRD-001
links:
  - {id: SPEC-001, type: implements}
  - {id: SPEC-002, type: relates-to}
  - {id: SPEC-006, type: relates-to}
---
# SPEC-005: Review Workflow

## 1. Purpose

Define the human-in-the-loop review workflow for documents. In Phase 1, this enables humans to review their own edits and track document maturity. In Phase 2, this becomes critical for reviewing agent-written content.

## 2. Core Flow

```
Document created (any source)
  │
  ▼ status = draft (default)
  │
  ├── lore pending ──→ shows in pending list
  │
  ├── lore diff <id> ──→ shows changes since last approved version
  │
  ├── lore approve <id>
  │     ├── status → approved
  │     ├── audit entry: {action: "approve", reviewer, timestamp}
  │     └── new version snapshot
  │
  └── lore reject <id> --reason "..."
        ├── status → draft (stays draft, reason recorded)
        └── audit entry: {action: "reject", reviewer, reason, timestamp}
```

## 3. ReviewService Interface

```typescript
interface ReviewService {
  pending(filters?: {
    author?: string      // filter by document creator
    type?: DocType       // filter by doc type
    since?: string       // ISO 8601 — docs modified after this time
  }): Promise<PendingDoc[]>

  approve(id: DocId, opts?: {
    reviewer?: string    // defaults to current user
  }): Promise<Doc>

  reject(id: DocId, opts?: {
    reviewer?: string
    reason?: string      // stored in audit entry
  }): Promise<Doc>
}

interface PendingDoc {
  id: DocId
  type: DocType
  title: string
  status: 'draft'
  created_by: string
  updated_at: string
  version: number
  change_summary?: string
}
```

## 4. Status Transition Rules

| Current Status | Action | New Status | Allowed By |
|---|---|---|---|
| draft | approve | approved | Any user (P1). Human only (P2 — agents cannot self-approve) |
| draft | reject | draft | Any user. Reason recorded in audit |
| in-review | approve | approved | Any user |
| in-review | reject | draft | Any user |
| approved | (edit) | draft | Auto-transition: any edit to approved doc resets to draft |
| approved | archive | archived | Any user |
| approved | deprecate | deprecated | Any user (must link to superseding doc) |

**Key rule**: Editing an `approved` document creates a new version and resets status to `draft`. This ensures approved docs are always reviewed before being re-approved.

## 5. Phase 2 Extensions

When MCP adapter and agent credentials arrive (P2):
- `pending --agent <agent-id>` filters by specific agent
- Agents cannot call `approve` — only humans can approve
- Agent-created docs default to `draft` (enforced by service layer based on credential type)
- Notification: `lore watch` (P2) can filter for pending-review events

## 6. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| 3 docs: A (draft), B (approved), C (draft) | `lore pending` | Shows A and C, not B |
| Doc X is draft | `lore approve X` | Status → approved, version incremented, audit entry with reviewer |
| Doc Y is approved | User edits Y via `lore set Y --content "new"` | Status resets to draft, new version created |
| Doc Z is draft | `lore reject Z --reason "incomplete"` | Status stays draft, audit entry records reason |
| No docs in draft | `lore pending` | Empty output: "No documents pending review" |
| Doc X is archived | `lore approve X` | Error: cannot approve archived doc |

## Code anchors

- packages/lore/src/service/review-service.ts
