---
id: TASK-1418
type: task
role: plan
title: "lore migrate v1 writes docs with no audit row and ignores an insertVersion failure"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"migration","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"162b8590-311f-47d9-b945-bf0f0108e29e"}
---

Split from #100 item 11. migration-service.ts:372 inserts without provenance; :385 ignores insertVersion's result.

**Expected:** Every imported doc has a version and an audit row, or the import fails loud
**Actual:** Docs with no audit row; version failures ignored
**Repro command:** `lore migrate v1 --from <dir>; lore log <doc>`

Reported by: agent:session-c1ffea04
