---
id: TASK-1420
type: task
role: plan
title: "lore link accepts a self-link"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"links","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"661f4782-32cc-4700-81b2-124dd5b9a5a0"}
---

Split from #100 item 7 (the deleted-target half is #70).

**Expected:** exit 4 refusing a link from a doc to itself
**Actual:** exit 0, self-link stored
**Repro command:** `lore link X X`

Reported by: agent:session-c1ffea04
