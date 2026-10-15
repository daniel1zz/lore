---
id: TASK-1359
type: task
role: plan
title: "lore run attest-input hard-codes mcp__lore__ prefix: renamed MCP servers still not attested"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"attribution-gap","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"45622640-2999-465b-ace8-757e8b4dad94"}
---

run.ts line 60 MCP_LORE_PREFIX is mcp__lore__ and gates rewriteMcpInput (line 261). The hook now spawns the verb for mcp__SERVER__lore_VERB, but the verb falls through to the Bash branch for mcp__lore-dev__lore_get and returns null, so no updatedInput is produced. Outside the hook task anchors (#146 hook half only).

**Expected:** attest-input rewrites mcp__SERVER__lore_VERB for any server name; other servers untouched
**Actual:** Only mcp__lore__* is rewritten by the real verb; mcp__lore-dev__lore_get returns null

Reported by: agent:session-66711aa8
