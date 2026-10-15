---
id: TASK-1022
type: task
role: plan
title: "pre-tool-harness-run hook rewrites only mcp__lore__* tools while its matcher routes every mcp__.*lore_.* tool"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"attribution-gap","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ee0abd5b-7bae-4926-b19c-8a324442676a"}
---

assets/hooks/pre-tool-harness-run.mjs:52 hard-codes MCP_TOOL_PREFIX='mcp__lore__'; distribution-hooks.ts:197 registers matcher 'mcp__.*lore_.*'.

**Expected:** Any lore MCP tool the matcher routes to the hook gets the harness_run argument, whatever server prefix Claude Code assigns (plain or plugin namespace)
**Actual:** A lore server installed under another prefix (e.g. a plugin namespace) passes through without harness_run, so every MCP write is recorded unattested and harness_run_attribution drops silently.

Reported by: agent:session-21d0be70
