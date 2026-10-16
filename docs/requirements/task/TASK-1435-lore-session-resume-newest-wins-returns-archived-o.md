---
id: TASK-1435
type: task
role: plan
title: "lore session resume (newest wins) returns archived or invalidated handoffs"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"session-surface","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"85454d42-64f7-4982-aa86-8ea03ae65278"}
---

Split from #95 item 3. session-service.ts:1041-1050 lacks the filter bootstrap applies at :549.

**Expected:** The same filter as bootstrap
**Actual:** An archived handoff is resumed
**Repro command:** `archive the newest handoff, then lore session resume`

Reported by: agent:session-c1ffea04
