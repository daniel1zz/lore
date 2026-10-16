---
id: TASK-1433
type: task
role: plan
title: "lore bootstrap pending_reviews counts every draft, not the lore pending set"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"session-surface","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c7fb89cc-0fa0-4e4b-a4ef-86c81d9297ea"}
---

Split from #95 item 1. session-service.ts:475 claims the same filter as lore pending but counts tasks, ledger docs and invalidated docs. Measured 363 vs 64.

**Expected:** pending_reviews equals lore pending's count
**Actual:** 363 vs 64
**Repro command:** `lore bootstrap --json; lore pending --json`

Reported by: agent:session-c1ffea04
