---
id: TASK-158
type: task
role: plan
title: "Fix Result-contract gap: BEGIN IMMEDIATE issued outside try/catch in SQLiteStore insertWithProvenance/updateWithProvenance"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Estimate: S

Found by SPEC-078 T2 liveness spike (2026-07-25): SQLiteStore.insertWithProvenance and updateWithProvenance run db.run("BEGIN IMMEDIATE") BEFORE their try/catch, so a synchronous bun:sqlite throw from that call escapes as a raw JS exception instead of the codebase's Result<T, LoreError> convention (observed live with SQLITE_IOERR_VNODE on a deleted-underneath corpus file). Independent of SPEC-078 scope — the multi-project dispatch boundary catches it defensively, but the store should honor its own contract.

AC:
- Given a Database whose file vanished, When insertWithProvenance/updateWithProvenance run, Then they return err(STORE_ERROR) (wrapStoreError), never throw — asserted by a bun test extending tests/unit/store coverage.
- Given the existing store bun suite, Then green (no behavior change on happy paths).
