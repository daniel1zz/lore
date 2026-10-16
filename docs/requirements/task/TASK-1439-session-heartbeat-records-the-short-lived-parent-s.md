---
id: TASK-1439
type: task
role: plan
title: "Session heartbeat records the short-lived parent shell pid, so a live session reads as dead"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"session-surface","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fdf40474-565e-45b2-9065-3bbd563fe8ac"}
---

Split from #95 item 6. Measured: recorded pid was dead seconds later.

**Expected:** A long-lived pid is recorded
**Actual:** Live session shown dead
**Repro command:** `lore session list; ps -p <pid>`

Reported by: agent:session-c1ffea04
