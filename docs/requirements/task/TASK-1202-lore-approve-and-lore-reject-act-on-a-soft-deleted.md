---
id: TASK-1202
type: task
role: plan
title: "lore approve and lore reject act on a soft-deleted document, while lore review reports it as not found"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"lifecycle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d69532c6-9674-4adb-8d57-8b193ced2855"}
---

Reproduced in a throwaway corpus: create a knowledge doc, delete it with --confirm, then run approve (succeeds, status approved, v2), reject on another deleted draft (succeeds). ReviewService.approve and reject resolve the doc through the shared resolver which does not check deleted_at, whereas CorpusService.getReviewBundle explicitly returns DOC_NOT_FOUND when deleted_at is set (review-service.ts approve ~667, reject ~950; corpus-service.ts getReviewBundle ~4539). A deleted document can therefore gain an approval version and audit entry, and a later restore brings back an approved doc nobody reviewed.

**Expected:** A deleted document is invisible to every review verb: approve and reject refuse it as not found, like review and pending do
**Actual:** After lore delete --confirm, lore approve moves the deleted draft to approved (v2, exit 0) and lore reject on a deleted draft exits 0 with 'Rejected ... (status remains: draft)'; lore review on the same slug exits 3 'Document not found'
**Repro command:** `lore create knowledge --title X --sub-type research --content c --parent <prd> && lore delete knowledge-x --confirm && lore approve knowledge-x`

Reported by: agent:review-excavator
