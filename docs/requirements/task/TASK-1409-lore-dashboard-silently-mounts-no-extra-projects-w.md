---
id: TASK-1409
type: task
role: plan
title: "lore dashboard silently mounts no extra projects when the machine config is unreadable"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"dashboard","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"bf83e5e2-cd4f-4f2e-820c-45a59c275a61"}
---

Split from #101 item 10. dashboard.ts:140-142 degrades silently.

**Expected:** A stderr warning naming the unreadable config
**Actual:** No diagnostic
**Repro command:** `make the machine config unreadable; lore dashboard`

Reported by: agent:session-c1ffea04
