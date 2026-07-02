---
id: TASK-017
type: task
role: plan
title: "Fix status db_size_bytes hardcoded 0"
status: archived
priority: low
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-002
plan: PLAN-002
---
CorpusService.status() hardcodes db_size_bytes: 0 (corpus-service.ts:841) though the comment claims SQLiteStore would provide it. Fix: add dbSizeBytes() to StoreInterface; SQLiteStore/TursoStore compute via PRAGMA page_count * page_size (works on bun:sqlite and libsql); InMemoryStore returns 0; status() consumes it. CLI already renders when > 0 (status.ts:210).
