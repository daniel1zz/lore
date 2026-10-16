---
id: TASK-1380
type: task
role: plan
title: "lore run register records the main run as the parent of every helper, so a helper started by another helper gets a guessed parent stated as fact (BR-1027)"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"corpus-truthfulness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"895fc311-879c-4323-856f-ee3934919cc8"}
---

BR-1027 says a helper's run records the run that started it. run-service.ts:142-146 sets parentRunId to the session's main run whenever agentId is present. The Claude Code hook payload carries no parent agent id (hooks docs: SubagentStart/SubagentStop fields are agent_id, agent_type, session_id ...), so for a helper started by another helper the registry cannot know the starter, yet it records main as if known. The corpus must not lie: an unknowable parent should read as unknown.

**Expected:** For a helper whose starter is not given by the harness, the run record's parent reads 'unknown' (or the payload's parent when one is ever provided); lore run show renders it as unknown, never as the main run
**Actual:** Every helper run, nested or not, gets parentRunId = cc:<session> (packages/lore/src/service/run-service.ts:142-146); lore run show prints that as the parent

Reported by: agent:session-2f964849
