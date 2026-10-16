---
id: TASK-1421
type: task
role: plan
title: "lore unlink reports success when no link existed"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"links","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"20a41849-8a5b-41a3-8980-141605959791"}
---

Split from #100 item 6.

**Expected:** exit 3 (or a no-op notice) when no link exists
**Actual:** 'Unlinked' and --json {ok:true,data:null}
**Repro command:** `lore unlink <a> <b>  # on unlinked docs`

Reported by: agent:session-c1ffea04
