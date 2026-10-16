---
id: TASK-1425
type: task
role: plan
title: "MCP lore_set can rewrite extra.uat of a recorded UAT verdict"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"uat-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a9640aa1-5d9e-4680-8c44-25292c7b0b37"}
---

Split from #99 item 7. set()'s record-edit gate compares only body, title and sub_type (corpus-service.ts:2324-2336); DEDICATED_EXTRA_KEYS does not protect knowledge.uat; MCP lore_set accepts extra (tools.ts:435).

**Expected:** Refused: only lore uat record may write extra.uat
**Actual:** The verdict is rewritten
**Repro command:** `lore_set on the uat doc with a changed extra.uat`

Reported by: agent:session-c1ffea04
