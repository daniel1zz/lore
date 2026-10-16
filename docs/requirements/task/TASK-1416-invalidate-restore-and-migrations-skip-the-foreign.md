---
id: TASK-1416
type: task
role: plan
title: "invalidate, restore and migrations skip the foreign-corpus write refusal"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"corpus-resolution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"630980f7-f9d6-4924-849b-575436b6b35d"}
---

Split from #100 item 11. refuseIfForeignCorpusWrite exists only in CorpusService; ValidityService writes the store directly (:698-722).

**Expected:** The same foreign-corpus refusal as every CorpusService write
**Actual:** The write goes through
**Repro command:** `from a foreign-resolved corpus: lore invalidate <doc>`

Reported by: agent:session-c1ffea04
