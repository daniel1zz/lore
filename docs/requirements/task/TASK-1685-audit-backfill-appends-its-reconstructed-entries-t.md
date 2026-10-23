---
id: TASK-1685
type: task
role: plan
title: "Audit backfill appends its reconstructed entries through the write port, not the store directly"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
Found 2026-10-20: since task-audit-backfill-takes-its-boundary-from-the-data-versions landed (a8d34975), single-write-path.bun.test.ts and write-path-everywhere.bun.test.ts fail on main: audit-backfill-service.ts:85 calls this.store.appendAuditEntry directly, and only corpus-service.ts and store/* may call a store write primitive. Fix: route the append through DocWritePort.appendAudit (as migrate-schema does via its verified writer) and wire it in audit-backfill-migration.ts, so the reconstructed entries also carry the caller's run. Oracle: both write-path tests and the backfill unit + integration tests pass.
