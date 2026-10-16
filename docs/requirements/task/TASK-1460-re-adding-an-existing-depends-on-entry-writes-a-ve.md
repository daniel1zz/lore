---
id: TASK-1460
type: task
role: plan
title: "Re-adding an existing depends_on entry writes a version labelled +1"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f0e11606-d5dd-4c5f-b22a-da7777721187"}
---

Split from #98 item 3. rule-service.ts:539-549.

**Expected:** A no-op with no version
**Actual:** A new version '+1'
**Repro command:** `add the same depends_on twice`

Reported by: agent:session-c1ffea04
