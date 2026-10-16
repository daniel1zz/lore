---
id: TASK-1419
type: task
role: plan
title: "lore restore audits and versions as the document author, not the caller"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"audit","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7c3b0a45-068a-468c-8ac2-3f61c939a1ed"}
---

Split from #100 item 8b. version-service.ts:278,289 take created_by and actor from the doc author.

**Expected:** The restore version and audit row name the actor who ran restore
**Actual:** They name the doc's author
**Repro command:** `restore as another actor, then lore log <doc>`

Reported by: agent:session-c1ffea04
