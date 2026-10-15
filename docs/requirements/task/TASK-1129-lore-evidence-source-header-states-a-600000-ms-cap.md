---
id: TASK-1129
type: task
role: plan
title: "lore evidence source header states a 600000 ms capture window default; the real default is 1200000 ms"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"doc-code-contradiction","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9e7500d8-ed4b-414f-82e6-4420e7f76404"}
---

The header comment of packages/lore/src/adapters/cli/commands/evidence.ts (lines 27-30) says --capture is bounded by workflow.evidence.capture_timeout_ms with 'default 600000 ms'. The default was raised to 1_200_000 ms on 2026-08-11 (packages/core/src/config.ts:544-569), so the comment states 10 minutes while the product uses 20. Found while reconciling the baseline-record-evidence leaf's Current values.

**Expected:** The evidence command's own description of the capture window names the same default the config schema applies (1200000 ms, 20 minutes), or cites the config field without restating a number.
**Actual:** evidence.ts:29 says 'default 600000 ms'; config.ts:569 defaults capture_timeout_ms to 1_200_000.
**Repro command:** `grep -n '600000' packages/lore/src/adapters/cli/commands/evidence.ts; grep -n '1_200_000' packages/core/src/config.ts`

Reported by: agent:blfix-A
