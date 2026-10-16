---
id: TASK-1462
type: task
role: plan
title: "One malformed evidence row empties the task's whole evidence list in rule-state"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a46ee2c2-daa2-4da2-a65b-3097641a5f0a"}
---

Split from #98 item 7. core/src/task-workflow.ts:1157-1161; attested-ac-runs.ts:74.

**Expected:** The malformed row is skipped and reported
**Actual:** All evidence dropped
**Repro command:** `write one malformed evidence row; lore baseline rule-state`

Reported by: agent:session-c1ffea04
