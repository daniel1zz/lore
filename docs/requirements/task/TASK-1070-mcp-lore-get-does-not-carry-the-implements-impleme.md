---
id: TASK-1070
type: task
role: plan
title: "MCP lore_get does not carry the Implements / Implemented by views that lore get prints (CLI/MCP parity)"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"parity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"dbbf88d5-cd6c-4f11-bc6f-b9d118d635cf"}
---

Found by the slice 3b view task (AC-BLS3B-4, 2026-10-10).

**Expected:** lore_get on a spec returns implements[] and on a rule-holding baseline node implemented_by[] (same lists as lore get --json)
**Actual:** packages/lore/src/adapters/mcp/tools.ts lore_get returns the raw corpus get result; the views are computed only in adapters/cli/commands/get.ts via service/spec-relations.ts

Reported by: agent:main-orchestrator
