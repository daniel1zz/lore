---
id: TASK-875
type: task
role: plan
title: "[Skill:implement] contract prose (must contain, in order + Adoption Mode) + pre-push failure text"
status: archived
priority: medium
phase: "Phase 2: Surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-880, type: blocks}
---
Estimate: M
Approach: edit contract §Root CLAUDE.md taxonomy ('exactly these headings' → 'must contain these H2 headings verbatim, in this order; other H2 sections may appear anywhere (advisory)') and add '## Adoption Mode' (enforce|warn, absent→warn, setup behaviour, WARN line, bootstrap field, promotable). No numbers in prose (SPEC-095 D1). Generalise the pre-push failure message in BOTH hook copies identically.
Source: spec-claude-md-root-section-structure-check-and-adoption-mode Scope; ADR decisions 1-5
Dimensions: D-DOC, D-FUNC
Scope-Alt: none
Covers: AC-STR-3, AC-STR-7

Run-only (not anchored, do not edit): packages/lore/tests/unit/assets-ssot.test.ts, packages/lore/tests/e2e/governance-claude-md-compiled.bun.test.ts, packages/lore/tests/unit/assets/claude-md-contract-content.test.ts (check it still passes after the 'exactly these headings' rewrite; if it pins that phrase, stop and report).
Rules: do NOT commit regenerated assets-manifest.ts (orchestrator regenerates after merge).

AC:
- `bunx vitest run packages/lore/tests/unit/assets/claude-md-contract-sections.test.ts packages/lore/tests/unit/assets/pre-push-parity.test.ts` passes; `cd packages/lore && bun test tests/integration/pre-push-structure-trip.bun.test.ts tests/e2e/governance-claude-md-compiled.bun.test.ts` passes (after `bun run build`).
