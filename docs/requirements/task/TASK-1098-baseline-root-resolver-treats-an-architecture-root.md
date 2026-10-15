---
id: TASK-1098
type: task
role: plan
title: "Baseline root resolver treats an architecture root as the product root"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"navigation-root","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"60223df1-7b86-4bd6-a9d1-30e08ff85b71"}
---

pickBaselineRoot (packages/lore/src/service/navigation-roots.ts) picks the oldest live baseline doc with extra.node === 'root' and never checks extra.tree. An architecture root also has node 'root' and also sits under the PRD, so when it is created before the business root it becomes the Root line of lore bootstrap and the default root of lore tree / HTTP /api/tree / MCP lore_tree (BR-981, BR-982, BR-321).

**Expected:** The navigation root is the business baseline root; an architecture root never displaces it (or the choice is stated explicitly).
**Actual:** Whichever node=root baseline doc was created first wins, business or architecture.

Reported by: agent:blfix-K
