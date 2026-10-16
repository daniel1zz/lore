---
id: TASK-1428
type: task
role: plan
title: "lore calibration accepts an unknown --doc-type with exit 0"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"calibration-args","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fcec24c5-01f5-442c-a1c4-aca7777f4140"}
---

Split from #99 item 3. calibration.ts:59 casts --doc-type without validation; its header comment :15 promises exit 4.

**Expected:** exit 4 naming the allowed doc types
**Actual:** exit 0
**Repro command:** `lore calibration --stats --doc-type bogus`

Reported by: agent:session-c1ffea04
