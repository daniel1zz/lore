---
id: TASK-1465
type: task
role: plan
title: "lore territory matches worktrees only by exact path string"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"territory","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f13225b9-eeba-4118-a769-5b203e7216df"}
---

Split from #95 item 8. territory-partition.ts:272,287 (see #158).

**Expected:** Branch-name and relative claims match
**Actual:** They are not matched
**Repro command:** `claim with --worktree <branch name>; lore territory`

Reported by: agent:session-c1ffea04
