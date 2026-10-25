---
id: TASK-1647
type: task
role: plan
title: "Dashboard multi-project e2e setup reads the server's ready line right after /health and leaks the server when parsing fails"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tests","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f7b4c4c3-b6ea-44c5-8558-5da296d41cab"}
---

The multi-project Playwright global setup starts lore serve, polls /health, and as soon as it returns 200 parses the server's stdout for its JSON ready line. The ready line can arrive after /health answers, so the parse intermittently throws 'No JSON line found'; the throw path does not kill the spawned server, which keeps port 8787 bound and makes the next run fail too.

**Expected:** the setup waits for the ready line itself (or a single readiness signal that implies it) and always kills the server it started when setup fails
**Actual:** intermittent 'No JSON line found' in multi-project global setup; the orphaned server keeps 8787 bound

Reported by: agent:session-a979eecd
