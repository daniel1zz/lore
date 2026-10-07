---
id: TASK-891
type: task
role: plan
title: "[Skill:implement] discover — three-layer fragment discovery with id override"
status: archived
priority: high
phase: "Phase 2: Pure services"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-893, type: blocks}
  - {id: TASK-905, type: blocks}
---
Estimate: S
Approach: per spec §Module Boundary discover.ts — read `<assetsRoot>/context`, `<xdgConfigHome>/lore/context`, `<projectRoot>/.lore/context` via injected FsReadPort; parse with `splitFrontmatter(text,'strict')` + FragmentFrontmatterSchema; id-override shipped<user<project; fail loud (Result err, LoreError VALIDATION_ERROR) on schema error, duplicate id within a layer (name both paths), body containing '<system-reminder'. Missing layer directory = empty layer (not an error).
Source: spec D1, D2, AC-CF-16; packages/core/src/frontmatter.ts; packages/core/src/fs-ports.ts
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-1, AC-CF-16

AC:
- `bunx vitest run packages/lore/tests/unit/context-fragments/discover.test.ts` → Tests N passed, 0 failed.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
