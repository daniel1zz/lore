---
id: TASK-1353
type: task
role: plan
title: "Root CLAUDE.md Module Index states 16 lore_* MCP tools; tools.ts registers 45"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"docs-drift","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"705aaaaf-a3d3-4dab-b68a-2d23256ef3bd"}
---

Hand-written CLAUDE.md restates a code fact (MCP tool count) with no drift oracle; it has silently gone stale. Found while scoping template+variable generation of lore-owned context.

**Expected:** Code-fact counts in CLAUDE.md match the registry (or are rendered from it)
**Actual:** CLAUDE.md:64 says '16 lore_* tools'; distinct "lore_*" names in packages/lore/src/adapters/mcp/tools.ts = 45, matching the 45 mcp__lore__* tools a session sees.

Reported by: agent:session-ee1cedaf
