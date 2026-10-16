---
id: TASK-1466
type: task
role: plan
title: "An unreadable report-issue receipt log silently skips the repeat check"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"bb67d7d8-3747-4626-84f7-4736901f946e"}
---

Split from #97 item 2. report-issue-wiring.ts:768-769.

**Expected:** A loud error, or the repeat check still runs
**Actual:** A report can be filed twice
**Repro command:** `chmod 000 the receipt log; lore report-issue twice`

Reported by: agent:session-c1ffea04
