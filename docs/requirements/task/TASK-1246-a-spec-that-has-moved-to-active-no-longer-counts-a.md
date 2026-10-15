---
id: TASK-1246
type: task
role: plan
title: "A spec that has moved to active no longer counts as approved for task-claim and plan approval, so work under an active spec can no longer be claimed"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"lifecycle-gap","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0a11114d-1fcf-41d5-9d7e-967f67b6993f"}
---

Found by pilot-v3 excavation (agent X): the claim gate and plan-promote accept only status approved for the upstream spec; elsewhere live = approved|active.

**Expected:** Upstream approval checks accept approved and active (the live statuses)
**Actual:** After spec approved->active, claiming its tasks and approving new plans under it is refused as UPSTREAM_NOT_APPROVED

Reported by: agent:main-orchestrator
