---
id: TASK-1449
type: task
role: plan
title: "A deprecated defect report computes as open forever and --check-issues keeps flagging it"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"67530d31-e23a-4dd0-8428-4e26835e1a9c"}
---

Split from #96 item 12. issue-resolution.ts:722-725.

**Expected:** A deprecated report resolves to a terminal state
**Actual:** open forever
**Repro command:** `deprecate a report task; lore status --check-issues`

Reported by: agent:session-c1ffea04
