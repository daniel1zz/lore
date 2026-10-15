---
id: TASK-1001
type: task
role: plan
title: "record-lock treats an archived never-approved knowledge record as ever-approved"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"governance","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2cfd4474-c6c4-4af1-a02d-36dca563108e"}
---

record-lock-service.ts:73 POST_APPROVAL_STATUSES = {approved, active, archived}; line 269 short-circuits everApproved=true on status alone. DRAFT_TO_ARCHIVED_ALLOWED_TYPES (packages/core/src/schemas.ts) lets knowledge go draft->archived directly, so a never-approved knowledge record reports 'locked (approved)'. Found by lore assess of plan-documents-are-living-or-records-record-edit-gate.

**Expected:** everApproved for an archived doc is decided from version/audit history (an approved row after the last reopen), not from the archived status; lore get never says 'locked (approved)' for a doc that was never approved
**Actual:** status archived alone yields everApproved=true and the lock reason 'approved'

Reported by: agent:session-cb37af5d
