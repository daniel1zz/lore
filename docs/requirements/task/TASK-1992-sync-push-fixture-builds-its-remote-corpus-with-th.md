---
id: TASK-1992
type: task
role: plan
title: "sync-push fixture builds its remote corpus with the store's own migration chain"
status: archived
priority: medium
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-251
plan: PLAN-251
---
Resolves #474. The sync-push fixture lists migrations by hand and stops at 039, so since migration 040 (#473) local is at user_version 40 and the fixture remote at 39. Build the fixture's remote corpus through the store's own migration chain (the same entry the store uses), so a new migration never needs a fixture edit. Oracle: bun run test:file packages/lore/tests/unit/adapters/sync-push.bun.test.ts passes; falsifier: append a dummy migration 041 to the store chain locally and the test still passes (fixture follows the chain), revert. Test-only change, claims no criterion.
