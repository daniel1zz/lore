---
id: TASK-623
type: task
role: plan
title: "[Skill:test] status --check-claude-md corpus-less oracle — RED"
status: archived
priority: critical
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-615, type: blocks}
---
Estimate: S
Source: spec §Module Boundary (config-only check path); paired impl = status check branch task
TDD-Role: red | Paired-Impl: status --check-claude-md task (same phase)

Scenarios:
- Given a temp dir with oversized CLAUDE.md and NO .lore/, When `lore status --check-claude-md` runs there, Then exit 3 with a finding naming the file (proves corpus-less operation)
- Given a conformant temp repo, When run, Then exit 0 and zero findings
- Given `context.memory_files.enabled: false` in .lore/config.yaml, When run, Then exit 0
- Given the check branch module, When its import graph is walked, Then no path reaches loadLoreApp/bun:sqlite (Invariant 2 pin)

AC:
- Scenarios exist at packages/lore/tests/integration/status-claude-md.test.ts + an import-graph pin
- Run → all RED; failure reason: flag not implemented, not test bugs
