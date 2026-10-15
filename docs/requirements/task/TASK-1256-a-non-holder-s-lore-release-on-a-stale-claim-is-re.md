---
id: TASK-1256
type: task
role: plan
title: "A non-holder's lore release on a stale claim is refused with 'or wait for the lease to expire', but expiry never makes a non-holder release possible"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"misleading-refusal","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ed75b5c5-3e27-4106-86fc-b301fdd3cd9b"}
---

task-workflow-service.ts:2776-2785 checks holder+force only, no staleness; the shared claim-conflict text (cli/utils.ts:296-298) tells the caller to wait. A stale claim can be taken over by claim (no steal) but not released. Found by probe v3 Q1.

**Expected:** The release refusal names the routes that work (claim takes over a stale claim; release needs holder or --force), never a wait that cannot succeed
**Actual:** release by bob on alice's 1621-minute-old claim -> exit 5 '... or wait for the lease to expire'; claim by bob -> exit 0

Reported by: agent:main-orchestrator
