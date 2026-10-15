---
id: TASK-1124
type: task
role: plan
title: "lore restore writes the document before its version and audit entries, so a later failure leaves an unrecorded change"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"audit-history","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c937a175-e3c9-4a12-af35-dd4488c3c9fb"}
---

VersionService.restore (packages/lore/src/service/version-service.ts:249-283) runs store.update (CAS), then store.insertVersion, then store.appendAuditEntry as three separate writes with no transaction. If insertVersion or appendAuditEntry fails after the update succeeded, restore returns an error but the document already holds the restored content at the new version number, with no version row and/or no audit entry for it. This breaks the corpus branch invariant that every accepted write leaves a version and an audit entry. Recorded as baseline rule BR-968 (unconfirmed, suspected defect) on baseline-restore-an-earlier-version.

**Expected:** A restore either lands all three of: document change, version entry, audit entry, or none of them
**Actual:** A failure after the document update leaves the document changed with no version entry or no audit entry; the command reports an error

Reported by: agent:blfix-B
