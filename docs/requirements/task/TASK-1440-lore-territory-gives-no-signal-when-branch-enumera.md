---
id: TASK-1440
type: task
role: plan
title: "lore territory gives no signal when branch enumeration fails"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"territory","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c5665906-e1f3-493e-a780-d572c2908380"}
---

Split from #95 item 9. commands/territory.ts:117; orphan branches silently disappear.

**Expected:** A warning naming the failure
**Actual:** Silent
**Repro command:** `make git branch fail; lore territory`

Reported by: agent:session-c1ffea04
