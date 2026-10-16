---
id: TASK-1429
type: task
role: plan
title: "lore eval fts always fails outside the lore repo because its queries name hardcoded lore slugs"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"eval-fts","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c7d8306c-8757-4e69-a9ba-6c9ac19983fa"}
---

Split from #99 item 2. fts-recall.ts:162 hardcodes this repo's slugs; a missing slug counts recall 0 and :317 fails the run.

**Expected:** Queries match the user's own corpus, or the scenario is skipped
**Actual:** Every query counts as recall 0; exit 1
**Repro command:** `lore eval fts  # in a fresh corpus`

Reported by: agent:session-c1ffea04
