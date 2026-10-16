---
id: TASK-1424
type: task
role: plan
title: "lore set accepts an empty or whitespace-only title"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"validation","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e0191e9b-ef27-4d7d-b939-470112d001d6"}
---

Split from #100 item 2. Reproduced: lore set X --title "   " writes v3, exit 0.

**Expected:** exit 4 refusing a blank title
**Actual:** exit 0, title stored blank
**Repro command:** `lore set <doc> --title "   "`

Reported by: agent:session-c1ffea04
