---
id: TASK-1459
type: task
role: plan
title: "The implementation-detail lint (BL-11) never warns at rule-add time"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"54ab76db-a33e-4451-b3d9-94af26d62a74"}
---

Split from #98 item 2. baseline-status.ts:302 is the only caller of lintRuleStatement.

**Expected:** A warning at lore rule add
**Actual:** Only counted in status
**Repro command:** `lore rule add with an implementation-detail statement`

Reported by: agent:session-c1ffea04
