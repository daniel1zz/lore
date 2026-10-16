---
id: TASK-1464
type: task
role: plan
title: "In lore seat remove the isMerged error aborts before --force is considered"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"seat","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f83c5138-d62f-42d2-b381-0aa89a133fa4"}
---

Split from #95 item 7. seat-service.ts:312-313. (Filing this report first failed because the expected text began with '--force': that is #239.)

**Expected:** Passing --force bypasses the merge check
**Actual:** The isMerged error aborts the removal
**Repro command:** `lore seat remove --force <unmerged seat>`

Reported by: agent:session-c1ffea04
