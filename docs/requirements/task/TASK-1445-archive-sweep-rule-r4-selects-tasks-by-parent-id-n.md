---
id: TASK-1445
type: task
role: plan
title: "Archive sweep rule R4 selects tasks by parent_id, not plan membership"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hygiene","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"8626bf61-6a2d-4a47-82de-6423b1cac579"}
---

Split from #96 item 6. core/src/archive-candidates.ts:260 contradicts :305-311.

**Expected:** Plan membership decides
**Actual:** parent_id decides
**Repro command:** `lore archive --sweep on a task filed under a PRD with plan_id set`

Reported by: agent:session-c1ffea04
