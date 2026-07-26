---
id: TASK-307
type: task
role: plan
title: "[Skill:test] assets-ssot conformance test (AC-046-D)"
status: archived
priority: medium
phase: "P0-assets"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-301, type: blocks}
---
Estimate: S
Approach: Write the asset SSOT conformance vitest — a static assertion over the `assets/` tree contents. Pure fs read + assert; vitest (no store, no bun:sqlite).
Source: SPEC-046 AC-046-D; test path fixed by the AC.
Dimensions: D-FUNC
Scope-Alt: none.
Covers: AC-046-D

AC:
- Given the repo `assets/` tree, When `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts` runs, Then it asserts GREEN that assets/skills, assets/agents, assets/hooks, assets/project contain every declared skill/agent/hook/project file (the exact set in the P0-vendor task).
- Given assets/governance/corpus-workflow.md, When the test reads it, Then it asserts the file exists, parses as standalone markdown, AND a negative-grep confirms no private-rule markers are present (R2 gate).
- Six-dimension shape: HAPPY (all present) + NEGATIVE (a missing declared file fails the test) + BOUNDARY (empty dir) + ERROR (unreadable path surfaced, not swallowed) + STATE (tree matches declared manifest) + REGRESSION (extra unexpected top-level file under assets/ flagged).
- Oracle: `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts` exits 0.
