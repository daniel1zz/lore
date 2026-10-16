---
id: TASK-1438
type: task
role: plan
title: "lore seat remove errors are labelled as a seat entry step"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"seat","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"88723766-1cf4-4bb4-ab63-23360069e01a"}
---

Split from #95 item 5. seat-service.ts:146-151.

**Expected:** The error names the remove step
**Actual:** 'seat entry step ... failed'
**Repro command:** `run lore seat remove twice`

Reported by: agent:session-c1ffea04
