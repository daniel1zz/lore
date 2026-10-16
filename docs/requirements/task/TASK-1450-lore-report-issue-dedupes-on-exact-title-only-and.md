---
id: TASK-1450
type: task
role: plan
title: "lore report-issue dedupes on exact title only and silently skips a different report with a filed title"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"29a378ed-b1ce-443e-ba95-c5d5a0068d50"}
---

Split from #97 item 1. report-issue-wiring.ts:577-591, :770-781.

**Expected:** A different report is filed or the duplicate is shown for confirmation
**Actual:** 'Already filed', exit 0, nothing filed
**Repro command:** `file two different reports with the same title`

Reported by: agent:session-c1ffea04
