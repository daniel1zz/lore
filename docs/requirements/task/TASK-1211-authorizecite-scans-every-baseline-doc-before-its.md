---
id: TASK-1211
type: task
role: plan
title: "authorizeCite scans every baseline doc before its short-circuit, adding a full scan to every armed ac cite"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"performance","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"68530d0f-ec17-4965-b77e-6b0268373412"}
---

Found by lore assess on plan-baseline-slice-2a: the corpus-scope authorization for ac cite runs findMany over all baseline docs before checking whether the write crosses any scope at all.

**Expected:** The inert-crossing short-circuit runs first; baseline docs are read only when a scope decision is actually needed (or via the rule_registry index)
**Actual:** Every armed ac cite pays a full baseline-doc scan

Reported by: agent:main-orchestrator
