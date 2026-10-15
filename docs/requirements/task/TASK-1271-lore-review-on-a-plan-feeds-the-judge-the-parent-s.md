---
id: TASK-1271
type: task
role: plan
title: "lore review on a plan feeds the judge the parent spec's BODY but not its structured ACs, so an AC added after the body was written is reported as missing and escalated to a human decision"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"judge-input-gap","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a4ecfb7e-3da4-4363-81a3-e8699610ab59"}
---

Structured ACs are the SSOT, but the plan-review judge evidently reads only the parent spec body's AC table; any AC added via lore ac add after the body was written is invisible to it.

**Expected:** The plan judge sees the parent spec's structured acceptance criteria (the SSOT from lore ac list), so a plan citing an existing AC id is not escalated
**Actual:** Plan citing AC-BLS1-12 (present in lore ac list, spec v34) was escalated twice with 'The parent's visible AC table ends at AC-BLS1-11'; approve refused until the AC JSON was pasted into the plan body. Repro: spec with body AC table ending at N, lore ac add N+1, create plan citing N+1, lore review plan.

Reported by: agent:main-orchestrator
