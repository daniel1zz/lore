---
id: TASK-1457
type: task
role: plan
title: "The MCP lore_report_issue description says reports go to an upstream review queue; they go to GitHub"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"mcp","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2e89501d-b78e-4386-a96b-db7aa2853333"}
---

Split from #97 item 10. adapters/mcp/tools.ts:3293.

**Expected:** The description names GitHub
**Actual:** It names a pending-review queue
**Repro command:** `read the lore_report_issue tool description`

Reported by: agent:session-c1ffea04
