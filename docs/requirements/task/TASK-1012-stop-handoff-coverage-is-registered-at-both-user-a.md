---
id: TASK-1012
type: task
role: plan
title: "stop-handoff-coverage is registered at both user and project level, so every coverage block prints twice"
status: archived
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"hook-registration","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"5b787596-314b-482a-8c0f-622895fe9499"}
---

~/.claude/settings.json:136 registers node ~/.claude/hooks/stop-handoff-coverage.mjs and .claude/settings.json:62 registers node $CLAUDE_PROJECT_DIR/assets/hooks/stop-handoff-coverage.mjs. Both fire on Stop with identical payloads. Nothing (lore setup --check, fragments check) detects one hook file registered at two layers.

**Expected:** Each shipped hook is registered at exactly one layer; lore setup --check reports a double registration
**Actual:** Session e25636da: the coverage-floor block message was delivered twice per stop

Reported by: agent:session-e25636da
