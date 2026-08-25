---
id: TASK-835
type: task
role: plan
title: "[Skill:implement] DUPLICATE_SLUG.existing_id names the rejected doc, not the existing one"
status: archived
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [store, false-label, corpus-truthfulness]
parent: PRD-001
---
MEASURED 2026-08-25 while implementing lore issue adopt.

sqlite-store.ts (~L556) and turso-store.ts (four insert sites) construct the DUPLICATE_SLUG error with existing_id: doc.id — the id of the NEW doc that was just rejected by the UNIQUE constraint and therefore never persisted. in-memory-store.ts:93 does it correctly, resolving the conflicting doc via findSlugConflict. Reproduced: corpusService.get(error.existing_id) returns DOC_NOT_FOUND every time.

This is a FALSE LABEL: the field name asserts 'the id of the doc that already holds this slug' and the value is an id that exists nowhere. A caller that trusts it — which is what the name invites — gets DOC_NOT_FOUND and has no way to reach the winner.

⛔ Why nothing caught it, and why a unit test alone will not: the two stores that get it wrong are the two that need a real database; the one that gets it right is the test double every unit test uses. Any oracle for this MUST run against SQLiteStore (and ideally TursoStore), not InMemoryStore.

FIX: look up the conflicting row's id before returning, the way in-memory-store.ts already does. Consider whether the three implementations should share one construction site so a fourth store cannot drift again.

CONSUMER IMPACT: spec-a-github-filed-defect-must-be-claimable-one-ingest-seam D2 depends on DUPLICATE_SLUG as its concurrency-convergence mechanism. The mechanism holds — the UNIQUE index still arbitrates — but recovery currently has to re-derive the deterministic slug instead of following existing_id. That workaround is documented at lore issue adopt's call site and in that spec's Review Revisions round 4; retiring the workaround is part of closing this task.
