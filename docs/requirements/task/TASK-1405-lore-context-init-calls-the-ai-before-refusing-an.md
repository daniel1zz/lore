---
id: TASK-1405
type: task
role: plan
title: "lore context init calls the AI before refusing an existing CLAUDE.md"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"context-init","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"5d1dc2b5-d65d-4dc4-86e6-feb52f99bf37"}
---

Split from #102 item 7. context.ts:602 calls the AI before the refusal at :611; the narrative is ignored when CLAUDE.md exists.

**Expected:** Refuse before any AI call
**Actual:** An AI call is made, then refused
**Repro command:** `lore context init --ai  # with CLAUDE.md present`

Reported by: agent:session-c1ffea04
