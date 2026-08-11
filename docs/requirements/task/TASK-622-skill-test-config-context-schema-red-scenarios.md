---
id: TASK-622
type: task
role: plan
title: "[Skill:test] config context schema — RED scenarios"
status: archived
priority: critical
phase: "Phase 1: Contracts & Content"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-620, type: blocks}
---
Estimate: S
Source: AC of the paired impl task (contextConfigSchema)
TDD-Role: red | Paired-Impl: task-skill-implement-contextconfigschema

Scenarios:
- Given no `context` section, When resolveMemoryFileBudgets(config), Then result deep-equals documented defaults
- Given partial override (root.max_lines only), When resolved, Then merge is field-level, siblings keep defaults
- Given `enabled: false`, When resolved, Then enabled false propagates and no other field mutates
- Given unknown key `context.memory_files.rootMaxLines`, When schema parses, Then ZodError (strict)

AC:
- All scenarios exist as executable vitest cases at packages/core/tests/config-context.test.ts (flat-file convention per config-staleness.test.ts / config-drift.test.ts)
- Run `bunx vitest run packages/core/tests/config-context.test.ts` → all RED; failure reason is missing exports (contextConfigSchema/resolveMemoryFileBudgets undefined), not test bugs
