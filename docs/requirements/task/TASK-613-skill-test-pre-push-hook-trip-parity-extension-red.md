---
id: TASK-613
type: task
role: plan
title: "[Skill:test] pre-push hook-trip + parity extension — RED (AC-CMC-3/4 paths)"
status: archived
priority: critical
phase: "Phase 3: Convergence & Verification"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-611, type: blocks}
---
Estimate: S
Source: AC-CMC-3/4; paired impl = pre-push convergence task
TDD-Role: red | Paired-Impl: pre-push pair + manifest task (same phase)

Scenarios:
- Given a temp git repo with over-ceiling CLAUDE.md + .lore/config.yaml default, When assets/project/pre-push executes, Then exit non-zero and stderr names the budget failure
- Given same repo with `context.memory_files.enabled: false`, When executed, Then exit 0
- Given a repo with NO .lore/, When executed, Then exit 0 (fail-open preamble)
- Given hooks/pre-push and assets/project/pre-push, When compared, Then byte-identical AND both contain the check-claude-md invocation (parity extension)

AC:
- Scenarios exist at packages/lore/tests/integration/pre-push-claude-md-trip.bun.test.ts (exact AC-CMC-3 path) + extended pre-push-parity.test.ts (AC-CMC-4)
- Run → all RED; failure: hook lacks the step — not test bugs
