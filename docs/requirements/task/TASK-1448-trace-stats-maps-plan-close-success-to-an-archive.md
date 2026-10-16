---
id: TASK-1448
type: task
role: plan
title: "trace stats maps plan-close success to an archive audit action that is never written"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"trace","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0944be83-c948-42f6-bdc5-e40d251898ed"}
---

Split from #96 item 11. trace-stats-service.ts:49.

**Expected:** The action that plan-close writes is counted
**Actual:** Always zero
**Repro command:** `lore trace stats after closing a plan`

Reported by: agent:session-c1ffea04
