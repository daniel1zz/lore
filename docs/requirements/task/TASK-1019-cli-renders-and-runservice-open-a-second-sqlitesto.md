---
id: TASK-1019
type: task
role: plan
title: "CLI renders and RunService open a second SQLiteStore instead of using the App's store"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"architecture","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"cea95d67-016f-4c27-9dd5-aee48f5173c2"}
---

get.ts:147, log.ts:38 and status.ts:1499/1577/1792 construct new SQLiteStore(dbPath) next to the App's own store.

**Expected:** Every read goes through the App-selected store (D-007), so a sync.enabled corpus reads its TursoStore replica and one command holds one connection
**Actual:** On a Turso corpus these paths read the local SQLite file directly, bypassing store selection; each opens an extra connection per command.

Reported by: agent:session-21d0be70
