---
id: TASK-1461
type: task
role: plan
title: "lore requirement add and rm record the actor as system in the version and audit rows"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"attribution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6644be01-aa55-4cac-9fd1-c6aadc3fa7df"}
---

Split from #98 item 4. requirement-service.ts:363,373; same pattern at drift-check-service.ts:346, phase-service.ts:526, phase-checklist-service.ts:464.

**Expected:** The calling actor is recorded
**Actual:** 'system'
**Repro command:** `lore requirement add <prd> ...; lore log <prd>`

Reported by: agent:session-c1ffea04
