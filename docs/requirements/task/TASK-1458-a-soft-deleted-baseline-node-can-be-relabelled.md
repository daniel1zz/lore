---
id: TASK-1458
type: task
role: plan
title: "A soft-deleted baseline node can be relabelled"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"59643df3-328f-4364-b43d-2cf432dbc1da"}
---

Split from #98 item 1 (measured). Related to #70.

**Expected:** Refused with exit 3 or 4
**Actual:** exit 0
**Repro command:** `lore delete <leaf> --confirm; lore baseline set-label <id> X`

Reported by: agent:session-c1ffea04
