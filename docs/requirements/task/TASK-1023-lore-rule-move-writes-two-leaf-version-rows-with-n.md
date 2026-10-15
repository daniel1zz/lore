---
id: TASK-1023
type: task
role: plan
title: "lore rule move writes two leaf version rows with no harness_run"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"attribution-gap","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"48d85bc3-c907-4fc8-9306-43a0bac6f0dd"}
---

RuleService.moveRule (rule-service.ts:418) never passes the invocation's run to store.moveRule, unlike allocateRuleAndUpdateLeaf (rule-service.ts:2249). Found while triaging the assess of plan-run-identity-slice-1-harness-attested-runs.

**Expected:** Every VersionRecord written under an attested invocation carries versions.harness_run (spec-run-identity-slice-1 D3/D4, AC-RID-5), including the from/to leaf rows store.moveRule builds inside the store
**Actual:** The two version rows of a registered rule move are recorded unattested; write-context-store.ts:18 says rule-registry writes must carry the run as a parameter. The AC-RID-5 matrix has no rule-move row, so nothing turns red.

Reported by: agent:session-21d0be70
