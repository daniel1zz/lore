---
id: TASK-871
type: task
role: plan
title: "[Skill:test] setup adoption both ends + fresh install — RED"
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
Source: spec-claude-md-root-section-structure-check-and-adoption-mode AC-STR-4, D4 (judge POST-SPLICE content); pattern tests/integration/setup-*.bun.test.ts
TDD-Role: red | Paired-Impl: I4
Covers: AC-STR-4

Scenarios (each in its own mkdtemp git repo):
- Fresh: `lore init` + `lore setup --project` with no CLAUDE.md → root CLAUDE.md H2 sequence contains the five required in order; .lore/config.yaml has adoption: enforce; `lore status --check-claude-md --json` exit 0 with adoption.mode 'enforce'.
- Existing non-conforming (only '## Notes') → adoption: warn written; setup output lists missing section names; check exit 0 with adoption.mode 'warn', mode_source 'config'.
- Existing conforming (five sections, no managed block) where post-splice content would duplicate a section → judged on post-splice content (expect warn + section_duplicate listed) — pins D4 ordering.
- Existing conforming with no overlap → enforce.
- Explicit adoption: warn already in config + conforming file → value NOT overwritten.
- Re-run setup over an install made with the OLD template → '## Module Index' still present.

AC:
- RED on the current base; record expected-fail evidence at the moment it is red (--ac AC-STR-4).
