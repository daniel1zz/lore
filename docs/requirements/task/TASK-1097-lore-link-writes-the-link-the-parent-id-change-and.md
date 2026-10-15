---
id: TASK-1097
type: task
role: plan
title: "lore link writes the link, the parent_id change and the audit entry as three separate writes, so a failure part-way leaves an unaudited parent change"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"atomicity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"1c929199-e295-44b6-86e2-d349ecc2311a"}
---

CorpusService.link (packages/lore/src/service/corpus-service.ts ~4533-4560) calls store.addLink, then for type=parent store.update(from, {parent_id}), then store.appendAuditEntry, each its own write. Create/update/delete use the single-transaction *WithProvenance store methods; link does not. A failure after addLink or after the parent_id update leaves the link (and for parent links the changed docs.parent_id) with no audit entry. Found while authoring architecture standard AS-10 (a document change lands with its records) for AC-BLS3-9.

**Expected:** A link (and a parent link's parent_id change) commits together with its audit entry in one transaction, like the *WithProvenance paths.
**Actual:** Three independent writes; partial failure leaves an unrecorded relationship or parent change.

Reported by: agent:arch-author
