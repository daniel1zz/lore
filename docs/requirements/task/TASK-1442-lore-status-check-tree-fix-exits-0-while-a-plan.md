---
id: TASK-1442
type: task
role: plan
title: "lore status --check-tree --fix exits 0 while a plan-terminality finding remains"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hygiene","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c7bff9ad-1419-4503-99b7-1a95bf949ea4"}
---

Split from #96 item 2. status.ts:1227-1233; check-only exits 3.

**Expected:** Non-zero while a finding remains
**Actual:** exit 0
**Repro command:** `lore status --check-tree --fix on a corpus with a terminality drift`

Reported by: agent:session-c1ffea04
