---
id: TASK-1427
type: task
role: plan
title: "lore feed --parent with an unresolvable id is silently dropped"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"feed","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"39eec292-f6fe-4372-bf20-a04d33c491d5"}
---

Split from #99 item 4a. feed-flow.ts:313 returns null on a failed resolve and :406-412 drops it; the header comment :18 promises an advisory.

**Expected:** An advisory note naming the unresolved parent
**Actual:** The parent is silently ignored
**Repro command:** `lore feed spec-create --parent nope`

Reported by: agent:session-c1ffea04
