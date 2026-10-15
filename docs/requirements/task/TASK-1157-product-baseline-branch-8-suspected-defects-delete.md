---
id: TASK-1157
type: task
role: plan
title: "Product-baseline branch: 8 suspected defects (deleted nodes editable, requirement/outline authorship, silent empty reads)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"product-baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"45fda7e2-9542-4035-8bbc-6d6c456778e9"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) a deleted baseline node can be relabelled, exit 0 rule-service.ts:429-440,654-660; (2) impl-detail rule statements accepted silently, only counted in status rule-service.ts:232-281, baseline-status.ts:283; (3) re-adding an existing dependency writes a version rule-service.ts:480-486; (4) requirement/outline writes recorded as system requirement-service.ts:268,278, prd-outline-service.ts:258,268,328,338; (5) unreadable stored requirement list treated as empty and overwritten on the next add requirement-service.ts:94-96,294-297; (6) requirement withdrawal checks only specs directly under the PRD :224-236; (7) one malformed evidence row drops all of a task's evidence from rule-state computation core task-workflow.ts:1015-1020; (8) unknown rule id: rule show exits 3 with a lore list hint, tree --rule exits 4 rule-state-service.ts:417-426. Also #72.

Reported by: agent:main-orchestrator
