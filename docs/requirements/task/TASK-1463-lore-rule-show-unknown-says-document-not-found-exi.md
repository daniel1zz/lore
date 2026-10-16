---
id: TASK-1463
type: task
role: plan
title: "lore rule show <unknown> says Document not found (exit 3) while tree --rule exits 4"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"cli-errors","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4124dac2-549f-44fa-871f-c66295e7e78e"}
---

Split from #98 item 8 (measured).

**Expected:** One error and exit code for an unknown rule id
**Actual:** Two different errors
**Repro command:** `lore rule show BR-99999; lore tree --rule BR-99999`

Reported by: agent:session-c1ffea04
