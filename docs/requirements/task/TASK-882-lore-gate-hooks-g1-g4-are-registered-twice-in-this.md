---
id: TASK-882
type: task
role: plan
title: "lore gate hooks g1-g4 are registered twice in this repo (global ~/.claude/hooks/lore-gate-* and project hooks/g*.sh on the same matchers)"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hook-wiring","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"bde0da9d-6c27-41f6-bab3-7a5c7dde1c86"}
---

~/.claude/settings.json wires lore-gate-g1..g4 on PreToolUse Bash and mcp lore_* matchers; .claude/settings.json in the lore repo wires $CLAUDE_PROJECT_DIR/hooks/g1..g4.sh on the same matchers. Every gated call runs each gate twice (double latency, and two independent copies that can drift). lore setup should detect and converge a duplicate global+project registration.

**Expected:** Each gate runs once per tool call
**Actual:** Each gate is invoked by both the user-level and project-level registrations
**Repro command:** `grep -n 'g1\|lore-gate' ~/.claude/settings.json .claude/settings.json`

Reported by: agent:main-orchestrator
