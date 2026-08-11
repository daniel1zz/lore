---
id: TASK-624
type: task
role: plan
title: "[Skill:test] init-context + template SSOT-consumption pins — RED (AC-CMC-5 path)"
status: archived
priority: high
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-621, type: blocks}
---
Estimate: S
Source: AC-CMC-5; paired impl = template+SKILL.md rewrite task
TDD-Role: red | Paired-Impl: template + init-context rewrite task (same phase)

Scenarios:
- Given assets/skills/lore-init-context/SKILL.md, When scanned, Then it contains BOTH literal commands `lore governance claude-md` and `lore status --check-claude-md`
- Given SKILL.md, When scanned for its former own-taxonomy section heading (What Goes In vs Stays Out), Then zero matches (second SSOT deleted)
- Given assets/project/CLAUDE.md.template, When scanned, Then it contains the pointer line referencing `lore governance claude-md` inside the managed marker section

AC:
- Scenarios exist at packages/lore/tests/unit/assets/init-context-contract.test.ts (exact AC-CMC-5 path)
- Run → all RED; failure: current assets lack the commands / still carry taxonomy — not test bugs
