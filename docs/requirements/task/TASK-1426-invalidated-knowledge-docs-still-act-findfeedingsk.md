---
id: TASK-1426
type: task
role: plan
title: "Invalidated knowledge docs still act: findFeedingSkill and getLatestUatVerdict ignore extra.validity"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"invalidation","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2dde7d13-e41a-4993-b6f2-f6b295367888"}
---

Split from #99 items 4b and 6 (one root cause). corpus-service.ts:4719 findFeedingSkill and :4005-4017 getLatestUatVerdict never check isInvalidated.

**Expected:** An invalidated feeding skill or UAT verdict is skipped
**Actual:** It still feeds gates and still satisfies plan-close
**Repro command:** `lore uat record <plan> --verdict accept; lore invalidate <uat-doc>; close the plan`

Reported by: agent:session-c1ffea04
