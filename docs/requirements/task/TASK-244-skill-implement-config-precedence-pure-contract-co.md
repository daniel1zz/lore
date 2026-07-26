---
id: TASK-244
type: task
role: plan
title: "[Skill:implement] config-precedence pure contract (core)"
status: archived
priority: high
phase: "Phase 1: Foundation + machine backend"
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-059
plan: PLAN-059
links:
  - {id: TASK-242, type: blocks}
---
Estimate: M
Approach: pure module in @lore/core mirroring config-editability.ts (zero IO, browser-safe); import mergeDefaults from @lore/core to derive precedence, never reimplement project-wins.
Source: SPEC-064 D4; @lore/core/config.ts::mergeDefaults, LoreDefaultsSchema (editor/format/color)
Dimensions: D-FUNC, D-CODE
Covers: AC-064-5, AC-064-6

Create `packages/core/src/config-precedence.ts` — a pure, browser-safe module deriving, for each `defaults.*` key (editor/format/color), which of three layers is EFFECTIVE: machine value, project override, built-in default. MUST import and use `mergeDefaults` (project spread last) rather than reimplementing precedence. Export a function returning per-key `{key, machine?, project?, builtin, effective, effectiveLayer: "machine"|"project"|"builtin"}`. Built-in defaults: format→"text", color→true, editor→undefined (falls through to $EDITOR/vi at runtime — represent honestly as "no built-in value"). This module is consumed by the Settings UI (T4) to DISPLAY precedence.

AC:
- config-precedence resolves the effective layer for all 8 presence combinations of machine/project across the 3 keys, and the effective value equals mergeDefaults(machine, project) (falls to built-in when both absent) — colocated test packages/core/src/config-precedence.test.ts, six dimensions.
- Adding config-precedence.ts keeps the @lore/core default barrel at 0 Node builtins — asserted by packages/core/tests/browser-safety.test.ts.
- Covers spec AC-064-5 (bunx vitest run packages/core/src/config-precedence.test.ts) and AC-064-6 (bunx vitest run packages/core/tests/browser-safety.test.ts).
