---
id: TASK-1009
type: task
role: plan
title: "Migration services rewrite locked records' titles/fields without the record-edit gate"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"governance","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9d3ae270-6f90-4e51-83c0-2df048eb4719"}
---

The record-edit gate (spec-documents-are-living-or-records-a-locked-record-is-never) refuses body/title rewrites of locked records on set/restore/ac/phase, but two maintenance services write directly to the store.

**Expected:** Every path that changes the body or title of a locked record goes through RecordLockService.assertEditable, or is listed as a sanctioned exception in the spec
**Actual:** ordinal-migration-service.ts ~684-696 strips ordinals from titles via store.update + insertVersion directly, including on approved specs/ADRs; phase-migration-service.ts ~474 rewrites task phase fields directly. Neither calls the gate nor is listed as an exception. Found by review of the merge of task-service-record-edit-gate-on-set-restore-ac-add-set-remove.

Reported by: agent:session-cb37af5d
