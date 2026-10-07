---
id: TASK-893
type: task
role: plan
title: "[Skill:implement] context refresh — fragments Z1 section, --scope user, CAS writes"
status: archived
priority: critical
phase: "Phase 2: Pure services"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-906, type: blocks}
  - {id: TASK-910, type: blocks}
---
Estimate: M
Approach: per spec D4, D8, D11, D14 — extend runContextRefresh(deps, root, {scope}) to call discover → checkOverrides → select('claude-md:project'|'claude-md:user') → renderOutlet → buildFragmentsSection → existing spliceManagedSections; write via CAS (hash read bytes; re-read before write; mismatch → err CONFLICT, no write). `--scope user` targets `<home>/.claude/CLAUDE.md`, touching only bytes between lore markers. All deps injected (fs, home, xdgConfigHome, assetsRoot, configs). Also update the governance pointer text at context-flow.ts:216 ("`lore governance` for the standing corpus-workflow discipline") to point at the Z1 fragments section / `lore fragments`, since D9 retires that topic.
Source: spec D8, D11, D14, AC-CF-6/13/15; packages/lore/src/flows/context-flow.ts (keep its Z1/Z2 invariants header)
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-6, AC-CF-13, AC-CF-15

AC:
- `bunx vitest run packages/lore/tests/unit/context-fragments/refresh-cas.test.ts` → Tests N passed.
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-6'` and `-t 'AC-CF-15'` → ≥1 pass, 0 fail each.
- Existing `bunx vitest run packages/lore/tests/unit/flows/context-flow.test.ts packages/lore/tests/unit/flows/context-flow-adoption.test.ts` stay green.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
