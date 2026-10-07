---
id: TASK-873
type: task
role: plan
title: "[Skill:test] check-memory-pointers never silent under warn — RED"
status: archived
priority: high
phase: "Phase 2: Surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
---
Estimate: S
Source: spec-claude-md-root-section-structure-check-and-adoption-mode AC-STR-9; measured regression 2026-10-07 (default warn → `--check-memory-pointers` exit 0 with NO output for a dangling slug)
TDD-Role: red | Paired-Impl: check-memory-pointers WARN task
Covers: AC-STR-9

Scenarios (vitest, mkdtemp repo + `lore init`, root CLAUDE.md with the five sections and one backticked dangling slug `knowledge-this-slug-does-not-exist-anywhere`; never this repo's .lore):
- no adoption key → `lore status --check-memory-pointers` exit EXACTLY 0; output has a line starting `WARN adoption=warn`; output names the dangling slug.
- `adoption: enforce` → exit EXACTLY 3; output names the dangling slug.
- `adoption: warn` + no dangling slug → exit 0, the slug text absent.

AC:
- RED on current main for missing implementation; record `--result expected-fail --capture --ac AC-STR-9` at red.
