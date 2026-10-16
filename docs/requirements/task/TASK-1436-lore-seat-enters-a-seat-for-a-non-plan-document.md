---
id: TASK-1436
type: task
role: plan
title: "lore seat enters a seat for a non-plan document"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"seat","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6552c260-d71e-4b61-9688-5a7fd5c60649"}
---

Split from #95 item 4. seat-service.ts:195-198; ready() errors and app.ts:914-917 swallows it as no conflicts.

**Expected:** Refused with exit 4
**Actual:** The seat is entered
**Repro command:** `lore seat <spec-slug>`

Reported by: agent:session-c1ffea04
