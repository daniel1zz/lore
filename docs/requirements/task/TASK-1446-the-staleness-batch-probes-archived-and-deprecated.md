---
id: TASK-1446
type: task
role: plan
title: "The staleness batch probes archived and deprecated docs"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"hygiene","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b535de3b-702c-4207-bd66-5ae491ccfb69"}
---

Split from #96 item 9. staleness-probe-service.ts:127-131; each costs an AI call.

**Expected:** Only live docs are probed
**Actual:** Terminal docs probed
**Repro command:** `lore review --staleness`

Reported by: agent:session-c1ffea04
