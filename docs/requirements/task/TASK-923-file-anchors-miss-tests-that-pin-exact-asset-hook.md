---
id: TASK-923
type: task
role: plan
title: "Task file anchors miss tests that pin exact asset/hook sets, so adding one asset turns out-of-anchor tests red mid-wave"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"planning-anchors","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9e18509e-f502-484b-92a7-2c90d7827b31"}
---

In plan-context-fragments-config-driven-layered-rule-injection, three separate tasks that each added ONE asset (assets/context/agent-rules.md; assets/hooks/session-start-fragments.mjs; deleting assets/governance/corpus-workflow.md) broke tests outside their declared anchors because those tests pin the EXACT asset/hook set: assets-ssot.test.ts (DECLARED_FILES), distribution-hooks.test.ts (entry/file counts), setup-service.test.ts (hook list), real-setup-ports.test.ts (declared asset set), npm-install-simulation.test.ts. The planner enumerated anchors by hand and the plan reviewer did not catch it either; each time the implementer either edited out of anchor (anchor gate blind) or stopped BLOCKED. Nothing maps 'adds/removes a file under assets/' to 'the set of tests that pin the asset inventory'.

**Expected:** Planning (lore-plan / lore create task --anchor) surfaces, for an anchor under assets/ or distribution-hooks.ts, the test files that pin the exact inventory, so they are anchored up front
**Actual:** Pinned-inventory tests are discovered only when they go red inside or after a worktree
**Repro command:** `grep -rlE 'DECLARED_FILES|exactly [0-9]+ entries|hook files registered' packages/lore/tests`

Reported by: agent:main-orchestrator
