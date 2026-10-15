---
id: TASK-1021
type: task
role: plan
title: "TursoStore migration 016 and harness_run inserts have no executed test"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"test-coverage","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0c1c141d-ceee-451d-83ac-26769eebc9d1"}
---

The write-attribution matrix covers SQLiteStore and InMemoryStore only; the only libsql contact is a hand-mirrored 016 copy in sync-push.bun.test.ts.

**Expected:** AC-RID-4/5 stamping and migration 016 are exercised against all three StoreInterface implementations, since sync.enabled corpora run on TursoStore
**Actual:** No test applies TursoStore's own two-phase 016 chain or asserts its insertAudit/insertVersion/insertRun write harness_run; a Turso-only divergence passes every oracle.

Reported by: agent:session-21d0be70
