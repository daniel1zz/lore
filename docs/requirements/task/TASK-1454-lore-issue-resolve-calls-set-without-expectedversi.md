---
id: TASK-1454
type: task
role: plan
title: "lore issue resolve calls set without expectedVersion, so a concurrent write can be overwritten"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"concurrency","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"17043d7d-bc3d-4527-b7af-8b63653c44c3"}
---

Split from #97 item 6. issue.ts:798.

**Expected:** Optimistic concurrency (STALE_VERSION on a race)
**Actual:** Last writer wins silently
**Repro command:** `race lore issue resolve with lore claim on the same report`

Reported by: agent:session-c1ffea04
