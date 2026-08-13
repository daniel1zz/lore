---
id: TASK-129
type: task
role: plan
title: "[Skill:test] T6r OutlineMigrationService dry-run invariants — RED scenarios"
status: archived
priority: critical
phase: "Phase 3: Migration machinery"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-128, type: blocks}
---
Estimate: S
Source: AC of task T6 (SPEC-080 Migration Plan)
TDD-Role: red | Paired-Impl: T6 migration service

Scenarios:
- Given a seeded prd with 3 domain sections on a throwaway corpus, When dry-run migrateSection, Then report carries per-section char-coverage + section-ref + R-id set-equality verdicts and doc version count is unchanged before/after (zero writes).
- Given a violation fixture (child doc missing a paragraph), When dry-run, Then the failed invariant is named and live run refuses to proceed for that section.
- Given a section already migrated (existing domain-doc slug marker), When re-run, Then zero writes (idempotency).
- Given live run on one section, Then order is observable: child doc + link exist BEFORE the prd body shrinks (two-step; asserted via version sequence).
- Given migrated fixture corpus, When bootstrap payload measured, Then PRD-derived content < 32000 chars (AC-080-8 pin).

AC:
- Executable at packages/lore/tests/unit/service/outline-migration-dryrun.bun.test.ts + packages/lore/tests/integration/bootstrap-outline-payload.bun.test.ts (bun runners — sqlite fixtures)
- Run → all RED for missing-implementation reasons only
