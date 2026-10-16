---
id: TASK-1441
type: task
role: plan
title: "tree-check --fix bumps the version without writing a version row"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hygiene","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"452f4d96-dfb4-4c33-bf32-7ec6e8ca2d77"}
---

Split from #96 item 1. tree-check-service.ts:306-315.

**Expected:** Every version bump writes a version row
**Actual:** lore log has a gap
**Repro command:** `lore status --check-tree --fix; lore log <doc>`

Reported by: agent:session-c1ffea04
