---
id: TASK-1407
type: task
role: plan
title: "lore context refresh deletes a hand-edited, deselected lore-*.md rules file"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"context-refresh","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"addae73a-6fb8-423c-9ba4-0a170f6baa01"}
---

Split from #102 item 1. context-flow.ts:590-604 cleans by the lore- prefix without checking the fingerprint; skill folders require an intact fingerprint (:661).

**Expected:** diverged_skip, as for skill folders
**Actual:** The hand-edited file is deleted
**Repro command:** `hand-edit a rules file; lore context remove <id>; lore context refresh`

Reported by: agent:session-c1ffea04
