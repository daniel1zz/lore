---
id: KN-894
type: knowledge
role: knowledge
title: "Evicted from the store module doc: migration 027 baseline items"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
---
Evicted verbatim from the module CLAUDE.md on 2026-10-23 (task G3: bring the file under its eviction floor). These are the pre-eviction lines; the module file keeps the rule and points here.

- **Single SQL migration set** — `migrations/migration-001` … `027` (022 = autonomy_thresholds, 023 = decision_log `superseded` verdict rebuild, 027 = baseline nodes converted to approved + pending items, BR-1341: `extra.rules`/`label`/`glossary`/`depends_on`/`commands` hold the APPROVED versions, `extra.pending` the pending ones, read only through `service/baseline-items.ts`; each converted node gets a version row and a chained audit row authored by `migrationActor`), inlined constants both stores apply; `LATEST_SCHEMA_VERSION` moves with each new migration. ⛔ **Never edit a shipped migration in place** — add a new one.
