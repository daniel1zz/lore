---
id: TASK-1204
type: task
role: plan
title: "In-review documents are invisible to lore pending (even --all) and to lore review --pending"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"lifecycle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6a9d8a6d-6d35-4b05-b767-6b4a594eafe1"}
---

Found by the review-branch probe author (plan-baseline-review-branch-migration-the-first-branch-eligible, W0) on a throwaway corpus; not fixed in that plan. A doc moved to in-review is absent from lore pending and lore pending --all, and lore review --pending skips it

**Expected:** A document in the in-review status appears in the pending-review queue and is picked up by the batch review run
**Actual:** A doc moved to in-review is absent from lore pending and lore pending --all, and lore review --pending skips it

Reported by: agent:main-orchestrator
