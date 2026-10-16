---
id: TASK-1455
type: task
role: plan
title: "lore issue resolve --state adopted accepts an archived or deprecated owner"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9371cc7e-9502-4300-a29c-39f9fd4f2afe"}
---

Split from #97 item 7. issue-resolution.ts:436-455.

**Expected:** Refused: the owner must be live
**Actual:** Accepted
**Repro command:** `lore issue resolve <r> --state adopted --adopted-by <archived plan>`

Reported by: agent:session-c1ffea04
