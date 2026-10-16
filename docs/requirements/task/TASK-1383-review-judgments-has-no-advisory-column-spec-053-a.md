---
id: TASK-1383
type: task
role: plan
title: "review_judgments has no advisory column: SPEC-053 advisory findings are lost on every SQLite/Turso read-back"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"judgment-persistence","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"18a3b2e3-a60e-479b-9f50-01ba18d42ae2"}
---

insertJudgment in both stores writes no advisory field and the row mapper reads none, so a judgment's advisory list exists only in the value returned at record time and in the in-memory store. Any later read (history, lore review listing, staleness, MCP reads) shows a judgment with no advisories. Same class as the truncated/truncation loss fixed by migration 019 (plan-close-the-eight-verified-critical-defects F1); advisory was deliberately left out of that task's scope. Found 2026-10-16 by the F1 implementer.

**Expected:** A judgment recorded with advisory items reads back from SQLite and Turso with the same items
**Actual:** advisory is absent after a round-trip through SQLiteStore

Reported by: agent:session-c1ffea04
