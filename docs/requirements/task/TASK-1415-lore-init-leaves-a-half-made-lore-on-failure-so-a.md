---
id: TASK-1415
type: task
role: plan
title: "lore init leaves a half-made .lore on failure, so a retry is refused"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"init","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"49cbe42d-659a-4112-8a3e-019d1143279f"}
---

Split from #101 item 1. init.ts:68-94 creates the directory before writing config and db; no rollback; createApp is not guarded.

**Expected:** A failed init leaves nothing behind (or a retry completes it)
**Actual:** Half-made .lore; the retry says already initialised
**Repro command:** `make config.yaml unwritable, run lore init twice`

Reported by: agent:session-c1ffea04
