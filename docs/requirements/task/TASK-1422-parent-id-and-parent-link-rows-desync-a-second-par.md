---
id: TASK-1422
type: task
role: plan
title: "parent_id and parent link rows desync: a second parent link keeps the old row and unlinking the parent leaves parent_id"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"links","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"74e2dc46-99ef-4a45-b3d6-e10df096b7b4"}
---

Split from #100 items 4 and 5 (one root cause). sqlite-store.ts:1467-1477 inserts a new parent link without removing the old one.

**Expected:** One parent link that always agrees with parent_id
**Actual:** parent_id and the tree still point at the unlinked parent
**Repro command:** `link K A --type parent; link K B --type parent; unlink K B; lore tree`

Reported by: agent:session-c1ffea04
