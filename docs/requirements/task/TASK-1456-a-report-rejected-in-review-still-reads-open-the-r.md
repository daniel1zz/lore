---
id: TASK-1456
type: task
role: plan
title: "A report rejected in review still reads open: the review-rejection argument is never passed in production"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f994689c-0c5e-48fc-9b7d-7b92baaafc0d"}
---

Split from #97 item 8. No caller passes the 4th argument (issues.ts:802, status-issue-check.ts:92 and 5 more).

**Expected:** The production path passes it
**Actual:** Always open
**Repro command:** `lore reject <report>; lore issues --local`

Reported by: agent:session-c1ffea04
