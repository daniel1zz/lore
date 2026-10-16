---
id: TASK-1430
type: task
role: plan
title: "lore eval migration imports into the live corpus with the secret scan forced off; --skip-secret-scan is a no-op"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"eval-migration","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4b1afea1-4d73-42f0-ac94-e0a3170e03b9"}
---

Split from #99 item 1. eval/scenarios/migration-coverage.ts:160-164 hardcodes dryRun:false, skipSecretScan:true; eval.ts:44's flag is never passed down; eval/CLAUDE.md:5,9 says eval is read-only.

**Expected:** The eval is read-only and the secret scan is on by default
**Actual:** A real import with no secret scan
**Repro command:** `lore eval migration --from <dir-with-a-secret> && lore list`

Reported by: agent:session-c1ffea04
