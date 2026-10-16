---
id: TASK-1434
type: task
role: plan
title: "An archived task stays in my_claims and is counted both claimed and done"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"session-surface","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6971bfa7-b783-410a-9496-f650bdf0071b"}
---

Split from #95 item 2. session-service.ts:483-511, :1270-1271; the claim is never cleared on archive (BR-331).

**Expected:** Terminal tasks are excluded from my_claims
**Actual:** The archived task is listed as claimed
**Repro command:** `claim a task, lore done it, lore bootstrap`

Reported by: agent:session-c1ffea04
