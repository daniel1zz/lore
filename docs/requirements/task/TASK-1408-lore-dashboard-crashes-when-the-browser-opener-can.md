---
id: TASK-1408
type: task
role: plan
title: "lore dashboard crashes when the browser opener cannot spawn; on win32 'start' always fails as a shell builtin"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"dashboard","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d2b85f05-98ce-482d-9255-9b8cf0c18e58"}
---

Split from #101 item 11. Reproduced with bun: spawn's async ENOENT exits 1 and escapes the try/catch.

**Expected:** The URL is printed and the server keeps running
**Actual:** Process exits 1
**Repro command:** `Linux with no xdg-open: lore dashboard`

Reported by: agent:session-c1ffea04
