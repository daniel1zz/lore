---
id: TASK-1086
type: task
role: plan
title: "Audit rows record no write surface: dashboard and CLI/MCP writes are indistinguishable in the audit trail"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"52213465-95b1-4682-8fba-b69954b1ca2e"}
---

Found while writing the BR-996 falsifying e2e (plan-p0-requirement-coverage-falsifying-criteria-for-8-rules).

**Expected:** An audit row carries the surface the write came from (cli / mcp / http_cookie / http_token)
**Actual:** corpus-service.ts:2836-2845 builds {timestamp, actor, session_id, action, doc_id, details} with no surface; source:'dashboard' exists only on the telemetry event (adapters/http/middleware.ts:243)

Reported by: agent:main-orchestrator
