---
id: TASK-1177
type: task
role: plan
title: "Deleting the same document twice fails with a raw storage error (UNIQUE constraint on versions)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"storage-error","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7d2e5a30-cf26-4584-bae5-f1ffa816fdca"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** A second delete of a soft-deleted document is refused with a typed error (or is idempotent)
**Actual:** Second lore delete exits 1: 'UNIQUE constraint failed: versions.doc_id, versions.version' — delete always writes version 0 (corpus-service.ts:3236); see #83

Reported by: agent:main-orchestrator
