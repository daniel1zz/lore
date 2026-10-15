---
id: TASK-1159
type: task
role: plan
title: "Hygiene branch: 12 suspected defects (tree repair history gaps, --fix exit codes, silent skips, archive --apply exit 0)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hygiene","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6fe55fc3-2c9f-4a4a-8d42-2537aab1d23b"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) tree repair bumps version without a history row tree-check-service.ts:302-313; (2) --check-tree --fix exits 0 while an open-plan finding remains (3 alone) status.ts:1280-1296; (3) status --fix alone silently ignored, exit 0 status.ts:1152-1159; (4) drift check skips unreadable anchors with no finding drift-check-service.ts:387-410; (5) unreadable requirement/outline lists treated as empty corpus-service.ts:4013-4021, status.ts:1440-1444; (6) legacy-task rule matches by parent, not plan membership core archive-candidates.ts:260-262; (7) archive --apply exits 0 when every item fails archive.ts:130-153; (8) archive and tree repair writes bypass the foreign-corpus refusal corpus-service.ts:3140, tree-check-service.ts:304; (9) staleness batch probes archived/deprecated docs staleness-probe-service.ts:125-135; (10) trace stats and audit accept --since yesterday, return empty, exit 0 trace.ts:182, audit.ts:255; (11) trace stats plan-close retry count depends on an audit action never written trace-stats-service.ts:36-44; (12) --check-issues alarms forever for resolved reports whose task is deprecated status.ts:448

Reported by: agent:main-orchestrator
