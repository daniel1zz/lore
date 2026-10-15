---
id: TASK-1122
type: task
role: plan
title: "lore setup install deletes a user-edited managed file that is no longer shipped, with no backup"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"data-loss","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a404a5da-c64f-4700-8c10-bd9d1253b955"}
---

Found while reconciling baseline leaf baseline-install-the-agent-integration with the code (2026-10-10). The install's removal step ignores whether the user changed a retired managed file.

**Expected:** A ledger-listed file the user changed since the last install (sha differs from the ledger) is either kept and reported as skipped like a diverged file (BR-818), or backed up into the backup run before removal
**Actual:** planInstall (packages/core/src/setup-manifest.ts:407-410) puts every ledger path absent from the payload into removals without comparing its on-disk sha to the ledger; SetupService.install (packages/lore/src/service/setup-service.ts:629-632) removes them, and backups only cover payload paths, so the user's edits are destroyed. Recorded as baseline rule BR-975 (unconfirmed) on baseline-install-the-agent-integration.

Reported by: agent:blfix-F
