---
id: TASK-1335
type: task
role: plan
title: "[Skill:test] claude_dir invocation variable — RED scenarios"
status: archived
priority: medium
phase: "Phase 3: Settings-hook claude dir and tool count"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
---
Estimate: S
Source: spec AC-CV-7, D7
TDD-Role: red | Paired-Impl: T5
Covers: AC-CV-7

Scenarios:
- Capture golden settings.json from the CURRENT code (before T5) for HOME=<mkdtemp> into packages/lore/tests/fixtures/context-variables/pre-change-settings.json (target dir normalised to a fixed token); after T5, a fresh spawned setup writes byte-identical settings.json.
- setup-service command strings containing {{lore:claude_dir}} resolve to the target dir via expandTemplate.
- No file under assets/ or packages/*/src contains "{{CLAUDE_DIR}}".

AC:
- packages/lore/tests/unit/setup/claude-dir-variable.test.ts (+ its committed golden fixture) written; RED on the token-absence and expandTemplate cases (missing implementation); expected-fail evidence recorded at red time.
