---
id: TASK-1413
type: task
role: plan
title: "lore setup --check treats an unreadable manifest as a fresh install"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"setup-check","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"402b07c9-0c25-4dcb-b037-e7646ce28dbe"}
---

Split from #101 item 3. setup-check.ts:296-299 maps any read error to ok(null).

**Expected:** A loud error naming the unreadable manifest
**Actual:** Reported as a fresh install
**Repro command:** `chmod 000 the manifest; lore setup --check`

Reported by: agent:session-c1ffea04
