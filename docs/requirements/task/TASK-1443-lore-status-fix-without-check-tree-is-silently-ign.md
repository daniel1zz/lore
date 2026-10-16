---
id: TASK-1443
type: task
role: plan
title: "lore status --fix without --check-tree is silently ignored"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"cli-args","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"1b94614c-dd21-4da6-a74a-26847d78a1f0"}
---

Split from #96 item 3. Measured exit 0.

**Expected:** Usage error, exit 2
**Actual:** exit 0
**Repro command:** `lore status --fix`

Reported by: agent:session-c1ffea04
