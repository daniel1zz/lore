---
id: TASK-1467
type: task
role: plan
title: "lore archive --apply exits 0 when items failed"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hygiene","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"59a36e55-4047-481e-8b23-26b9cacfe56a"}
---

Split from #96 item 7. archive.ts:186.

**Expected:** Non-zero exit when any item failed
**Actual:** exit 0
**Repro command:** `lore archive --apply with a refusing item`

Reported by: agent:session-c1ffea04
