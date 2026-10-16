---
id: TASK-1423
type: task
role: plan
title: "lore list with an unknown --type or --status is silently empty with exit 0"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"validation","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0c98acf7-8064-4593-9d46-3a127623f908"}
---

Split from #100 item 3 (same class as #81, different command).

**Expected:** exit 4 naming the allowed values
**Actual:** 'No documents found.' exit 0
**Repro command:** `lore list --type bogus`

Reported by: agent:session-c1ffea04
