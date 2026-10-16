---
id: TASK-1417
type: task
role: plan
title: "lore migrate v1 exits 0 (--json ok:true) while files failed"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"migration","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7b89de41-d961-403b-b3b6-e7d769b1fd35"}
---

Split from #100 item 11. migrate.ts:549-573 exits 0 with per-file errors.

**Expected:** Non-zero exit when any file failed
**Actual:** exit 0, ok:true
**Repro command:** `import a dir containing a duplicate slug`

Reported by: agent:session-c1ffea04
