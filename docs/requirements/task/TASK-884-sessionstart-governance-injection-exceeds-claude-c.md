---
id: TASK-884
type: task
role: plan
title: "SessionStart governance injection exceeds Claude Code's 10,000-char hook-output cap, so the model sees only a 2KB preview"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"critical","category":"hook-output-cap","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"55ee7fdf-704d-43bb-bc4a-04ba2db8393c"}
---

Claude Code caps each hook additionalContext/stdout string at 10,000 chars (hooks.md: 'capped at 10,000 characters ... replaces it with the file path and a preview of up to the first 2,000 characters ... Claude Code doesn't ask Claude to read the file ... no setting or environment variable to raise it'). The lore SessionStart hook (session-start-resume.mjs, governance snippet + bootstrap) emits ~13.6KB, so in this session the harness printed 'Output too large (13.6KB). Full output saved to ...tool-results/hook-...txt  Preview (first 2KB)'. Everything after 2KB (FEED/PRODUCE/EXECUTE rules, armed_gates, my_claims, latest_handoffs) never reaches the model, silently. Fix at mechanism root: split into multiple per-string <10K outputs or move static governance into CLAUDE.md/rules and keep only dynamic bootstrap in the hook; add an oracle asserting each emitted string < 10000 chars.

**Expected:** Every SessionStart-injected string stays under 10,000 chars so the full governance + bootstrap reaches the model
**Actual:** 13.6KB single output persisted to disk; model receives only a 2,000-char preview with no error
**Repro command:** `node ~/.claude/hooks/session-start-resume.mjs < /dev/null | wc -c`

Reported by: agent:main-orchestrator
