---
id: TASK-1437
type: task
role: plan
title: "lore seat remove keeps the branch although its help says it removes both"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"seat","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9053ff22-bde8-4af7-b38d-44fb63dbfc9a"}
---

Split from #95 item 5. Only git worktree remove runs (real-git-port.ts:776 vs commands/seat.ts:8).

**Expected:** Worktree and branch removed
**Actual:** Branch kept
**Repro command:** `lore seat remove <seat>`

Reported by: agent:session-c1ffea04
