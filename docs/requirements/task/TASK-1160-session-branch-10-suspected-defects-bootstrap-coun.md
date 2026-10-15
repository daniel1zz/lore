---
id: TASK-1160
type: task
role: plan
title: "Session branch: 10 suspected defects (bootstrap counts, my_claims after done, resume picks archived handoffs, seats)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"session-surface","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c559b5f7-0cd8-477b-883e-8230b2ba1816"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) bootstrap pending count includes every draft (271 vs lore pending 75) service/session-service.ts:374; (2) archived task still listed in bootstrap my_claims, counted claimed and done :382,:1094; (3) resume-by-newest hands out archived/invalidated handoffs while bootstrap skips them :868; (4) a seat can be entered for a non-plan doc; conflict check fails silently seat-service.ts:195, app.ts:802; (5) seat remove keeps the branch though help says both are removed real-git-port.ts:776 vs seat.ts:8; second remove exits 1 naming a seat entry step seat-service.ts:150; (6) session heartbeat records a short-lived shell, so a live session shows dead commands/session.ts:149; (7) seat remove merge check against main runs before --force seat-service.ts:312 (code); (8) territory matches worktrees by exact path only territory-partition.ts:287 (code); (9) failure to list branches silently drops them :321 (code); (10) comment says handoffs are draft, they are created approved session-service.ts:707

Reported by: agent:main-orchestrator
