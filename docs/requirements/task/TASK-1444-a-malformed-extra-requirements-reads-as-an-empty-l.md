---
id: TASK-1444
type: task
role: plan
title: "A malformed extra.requirements reads as an empty list, so the check passes and requirement add overwrites the list"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"data-loss","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"85fcf7bf-32af-408b-a39c-f7b9e4bc641e"}
---

Split from #96 item 5 and #98 item 5 (one root cause). corpus-service.ts:4236-4237; requirement-service.ts:389-391, :107-108. Malformed lists can be written through MCP raw extra (tools.ts:350/435).

**Expected:** A malformed list fails loud and is never overwritten
**Actual:** Read as []; --check-requirements passes; add overwrites
**Repro command:** `write a malformed extra.requirements via lore_set, then lore requirement add`

Reported by: agent:session-c1ffea04
