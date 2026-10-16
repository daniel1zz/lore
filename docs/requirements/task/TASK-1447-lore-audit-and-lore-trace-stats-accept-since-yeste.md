---
id: TASK-1447
type: task
role: plan
title: "lore audit and lore trace stats accept --since yesterday and return empty with exit 0"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"cli-args","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0fc5c45b-d7bc-4b14-880e-9aba9ea1c304"}
---

Split from #96 item 10 (measured). Sibling of #81.

**Expected:** An unparseable --since is refused (exit 2 or 4)
**Actual:** Empty result, exit 0
**Repro command:** `lore audit --since yesterday`

Reported by: agent:session-c1ffea04
