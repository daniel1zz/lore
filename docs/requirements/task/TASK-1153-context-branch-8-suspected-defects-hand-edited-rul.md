---
id: TASK-1153
type: task
role: plan
title: "Context branch: 8 suspected defects (hand-edited rules files deleted, stale warnings that never clear, LORE_CONFIG_HOME mismatch)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"context","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fa0fdbd4-6161-4527-bff5-db5130a33679"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) removing a fragment deletes a hand-edited lore-*.md rules file, losing the edits context-flow.ts:515-528; (2) a hand-edited rules file triggers a stale warning every session that the suggested refresh skips forever fragments-flow.ts:180-183 vs context-flow.ts:503-505; (3) with LORE_CONFIG_HOME set, context refresh --scope user reads the default location, writes nothing, prints Wrote; fragments verbs read the new location context.ts:385 vs fragments.ts:91-96; (4) fragments check never compares user-scope rules files fragments-flow.ts:457; (5) refresh silently deletes managed-zone sections outside the four known ones context-projection.ts:422-433; (6) corrupt package.json written as no scripts found, no warning context-facts.ts:172-185; (7) init calls the AI narrative before refusing an existing CLAUDE.md context.ts:419 vs context-flow.ts:352; (8) session-start injection does not check the illegal overrides that refresh/check refuse fragments-flow.ts:275-296 (code)

Reported by: agent:main-orchestrator
