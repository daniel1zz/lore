---
id: TASK-1205
type: task
role: plan
title: "lore reject on an in-review doc prints 'status remains: draft' although it moved in-review -> draft"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ced0a22e-f053-4dac-9d28-db54f4771dbb"}
---

Found by the review-branch probe author (plan-baseline-review-branch-migration-the-first-branch-eligible, W0) on a throwaway corpus; not fixed in that plan. Reject of an in-review doc changes status in-review -> draft; output says 'status remains: draft'

**Expected:** The reject output names the actual transition (in-review -> draft)
**Actual:** Reject of an in-review doc changes status in-review -> draft; output says 'status remains: draft'

Reported by: agent:main-orchestrator
