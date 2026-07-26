---
id: TASK-137
type: task
role: plan
title: "[Skill:test] T2r PrdOutlineService + set-guard — RED scenarios"
status: draft
priority: critical
phase: "Phase 1: Core schemas & outline writer"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-136, type: blocks}
---
Estimate: S
Source: AC of task T2 (SPEC-080 C1 dedicated-writer contract)
TDD-Role: red | Paired-Impl: T2 PrdOutlineService

Scenarios:
- Given a prd with 3 outline entries, When outlineSet patches section B, Then entries A and C are byte-identical before/after and version bumps exactly once.
- Given a direct CorpusService.set extra patch containing outline key, When applied, Then VALIDATION_ERROR whose message names `lore outline`.
- Given a direct set patch dropping prd_sync_exempt (present-before absent-after), When applied, Then VALIDATION_ERROR naming the dedicated writer.
- Given outlineSet on a non-prd doc, When applied, Then VALIDATION_ERROR naming allowed type.
- Given outlineSet with unknown section key and no --create intent, Then VALIDATION_ERROR listing declared keys.
- Given exempt verb without reason, Then VALIDATION_ERROR naming reason.
- Given renderOutlineContent over a 2-entry outline, Then output contains both rendered headings in declaration order and nothing else (snapshot).

AC:
- All scenarios executable (vitest, packages/lore/tests/unit/service/outline-writer-guard.test.ts)
- Run tests → all RED for missing-implementation reasons only
