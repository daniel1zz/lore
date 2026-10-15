---
id: TASK-1183
type: task
role: plan
title: "lore review --pending exits 6 (AI failure) whenever every document in the batch fails, whatever the failure cause"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e6595f11-9b7f-4575-b75c-0fcc0cd72d5e"}
---

Found by the W6 remediation drafter of plan-baseline-review-branch-migration-the-first-branch-eligible (code reading + throwaway corpus); not fixed there.

**Expected:** The batch exit code reflects the failure kinds (e.g. 4 for deterministic-check refusals), or a mixed-cause batch names the causes
**Actual:** All-failed batch returns exit 6 even when no AI call failed

Reported by: agent:main-orchestrator
