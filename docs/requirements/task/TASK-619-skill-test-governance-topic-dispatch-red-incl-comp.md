---
id: TASK-619
type: task
role: plan
title: "[Skill:test] governance topic dispatch — RED incl. compiled e2e (AC-CMC-2 path)"
status: archived
priority: high
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-617, type: blocks}
---
Estimate: S
Source: AC-CMC-2; paired impl = governance topic registry task
TDD-Role: red | Paired-Impl: governance topic registry task (same phase)

Scenarios:
- Given `dist/lore governance claude-md`, When run, Then stdout is byte-identical to assets/governance/claude-md-contract.md and exit 0
- Given `lore governance` (no topic), When run, Then corpus-workflow prose prints (back-compat default unchanged)
- Given `lore governance claude-md seat-briefing` (two topics), When run, Then exit 2 with message naming both
- Given legacy `--seat-briefing` flag, When run, Then output byte-identical to `lore governance seat-briefing` plus one deprecation line on stderr

AC:
- Compiled-binary scenarios exist at packages/lore/tests/e2e/governance-claude-md-compiled.bun.test.ts (exact AC-CMC-2 path); registry-unit scenarios in the governance unit suite
- Run → all RED; failure reason: topic dispatch not implemented / asset absent, not test bugs (requires `bun run build` freshness per repo standing lesson)
