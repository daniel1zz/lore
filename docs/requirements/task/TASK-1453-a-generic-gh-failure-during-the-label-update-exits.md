---
id: TASK-1453
type: task
role: plan
title: "A generic gh failure during the label update exits 4, the same code as a refusal, though the resolution was recorded"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a71e3f90-2922-4a5b-b610-bd4ef83fb492"}
---

Split from #97 item 5. issue.ts:906-911; gh-runner.ts:226-231.

**Expected:** A transport exit code (9) and a note that the resolution was recorded
**Actual:** exit 4
**Repro command:** `lore issue resolve with gh failing`

Reported by: agent:session-c1ffea04
