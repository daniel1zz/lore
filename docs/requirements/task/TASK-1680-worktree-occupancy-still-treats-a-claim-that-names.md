---
id: TASK-1680
type: task
role: plan
title: "Worktree occupancy still treats a claim that names no run as occupying, a state the store now refuses"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"claims","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9a346b8c-0dc0-48ac-bd1d-41262f17c6ec"}
---

BR-1216 (lore run occupancy) counts a worktree as occupied when a claim's run has not ended or the claim names no run. Since BR-1352 the store refuses to write a claim without a run and pre-run claims were expired by the schema upgrade, so the no-run branch only serves a state that can no longer exist; keeping it means occupancy code still models legacy claims.

**Expected:** occupancy is decided by runs only; the no-run branch and its rule clause are removed
**Actual:** BR-1216: 'The worktree counts as occupied when ... a claim's run has not ended or names no run.'

Reported by: agent:session-a979eecd
