---
id: TASK-1431
type: task
role: plan
title: "lore agent create takes the name as --name but agent revoke takes it as a positional"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"agent-cli-arg-style","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0128951d-a8b8-4626-8916-5f3819f9bbc1"}
---

Split from #91 (BR-1153).

**Expected:** One argument style for the agent name across both subcommands
**Actual:** create --name x works; revoke --name x fails with 'Missing required positional argument: NAME' (exit 1)
**Repro command:** `lore agent create --name dup && lore agent revoke --name dup`

Reported by: agent:session-c1ffea04
