---
id: TASK-1184
type: task
role: plan
title: "lore pending accepts an unknown --type or an unparseable --since and shows an empty queue with exit 0"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"cli-usage","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e8d10d0f-13f8-449c-baf2-b3e65006e418"}
---

Found by the W6 remediation drafter of plan-baseline-review-branch-migration-the-first-branch-eligible (code reading + throwaway corpus); not fixed there.

**Expected:** An unknown document type or an unreadable date is a usage error (exit 2) naming the valid values
**Actual:** A typo in --type or --since reads as 'nothing awaiting review', exit 0 (recorded as unconfirmed baseline rule BR-318)

Reported by: agent:main-orchestrator
