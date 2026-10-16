---
id: TASK-1451
type: task
role: plan
title: "GitHub reads use per_page=100 without pagination, so issues past 100 are invisible"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b0074965-5f67-42fd-9137-04fc7f632cbd"}
---

Split from #97 item 3. github-intake-port.ts:400; issues.ts:1034. Pull requests count toward the 100. Measured 2026-10-16: lore issues showed 100 of 224.

**Expected:** Every issue is read
**Actual:** Only the newest 100
**Repro command:** `lore issues --all --json | jq .data.total  # vs gh issue list --state all`

Reported by: agent:session-c1ffea04
