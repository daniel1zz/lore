---
id: TASK-1248
type: task
role: plan
title: "Setting a plan's status straight to approved skips the plan-promote gate in the service layer; only the shipped agent hook catches it"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"gate-bypass","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2930c2f6-0ebc-4ac4-8c5d-3291035cfc3e"}
---

Found by pilot-v3 excavation (agent X, plan-the-work leaf): corpus-service.ts:2394-2398 runs the promote checkpoint only for specs on a set->approved. CLAUDE.md says gates run in the service layer so CLI/MCP/HTTP are gated identically.

**Expected:** lore set <plan> --status approved runs plan-promote in the service layer, like lore approve and like specs
**Actual:** A plan under a draft spec can be set approved directly via the service (MCP/HTTP/CLI without the hook)

Reported by: agent:main-orchestrator
