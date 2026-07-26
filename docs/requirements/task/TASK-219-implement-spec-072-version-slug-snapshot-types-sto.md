---
id: TASK-219
type: task
role: plan
title: "Implement SPEC-072: version slug snapshot (types + stores + migration + log + restore pin)"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-047
plan: PLAN-047
---
See spec spec-version-snapshots-capture-slug-values-spec-068-d5-follow-up D1-D4. Test files per AC commands: packages/lore/tests/unit/service/version-slug.test.ts (vitest, InMemoryStore) + packages/lore/tests/unit/store/version-slug-migration.bun.test.ts (bun:sqlite).
