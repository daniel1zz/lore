---
id: TASK-1060
type: task
role: plan
title: "check-shipped-defaults REGRESSION control expects workflow undefined on a fresh tree, but it is defined"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"test","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"217e2208-3de2-4654-a3f9-9639532784e8"}
---

Pre-existing: fails at 27969373 and at current main (measured 2026-10-11 by the main-red triage task).

**Expected:** scripts/tests/check-shipped-defaults.test.ts REGRESSION control passes on a fresh tree, or its expectation is updated to the shipped defaults
**Actual:** the control asserts workflow === undefined; the fresh-tree config now defines workflow

Reported by: agent:main-orchestrator
