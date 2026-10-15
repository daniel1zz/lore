---
id: TASK-1020
type: task
role: plan
title: "AC-LL-10 source scan cannot see createAppWithWriteContext"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"oracle-blind-spot","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c4bd3b4c-2c7a-48d8-9cda-9c264beb174c"}
---

loader.ts now builds every identity-carrying CLI App through app.ts::createAppWithWriteContext, which forwards a third argument to createApp. Introduced by task-skill-implement-fix-full-suite-regressions-introduced-by.

**Expected:** The pin that no App-construction call site passes a sync-bearing config (libsql-lazy-load AC-LL-10) covers every entry point reaching createApp, wrappers included
**Actual:** The scan matches only the literal createApp( call shape; the wrapper is guarded only by its 'sync?: never' parameter type, so a cast or widened type would reopen the Turso createRequire path in the compiled binary with every oracle green.

Reported by: agent:session-21d0be70
