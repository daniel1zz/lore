---
id: TASK-1296
type: task
role: plan
title: "lore fragments check enumerates only shipped agent types, so user-defined subagents (~/.claude/agents, .claude/agents) are never budget-checked"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"fragments-check","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2d5821b1-8e52-40c2-b9e0-c4a473e7a495"}
---

lore fragments check builds its agentTypes list from <assetsRoot>/agents/*.md + 'subagent:*' (observed JSON: agentTypes [lore-explorer, lore-implementer, lore-reviewer, subagent:*]). A user's own agents (here tester, researcher, ui-variant-builder in ~/.claude/agents) can be addressed by fragments via audience subagent:<type> and receive the hook:subagent-start render, but their budget is never checked; an over-cap set would only surface at runtime as a BUDGET_EXCEEDED banner instead of the fragment text. Measured 2026-10-07 by rendering manually: tester 7,846 chars (within cap, so no live failure yet).

**Expected:** check enumerates every agent type that exists in ~/.claude/agents and <project>/.claude/agents plus every subagent:<type> named in any fragment audience
**Actual:** only shipped agent types are checked
**Repro command:** `lore fragments check --json | jq .data.agentTypes`

Reported by: agent:main-orchestrator
