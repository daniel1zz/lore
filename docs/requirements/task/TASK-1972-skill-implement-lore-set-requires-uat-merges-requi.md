---
id: TASK-1972
type: task
role: plan
title: "[Skill:implement] lore set --requires-uat merges requires_uat into a plan's extra; plan-promote pack names it"
status: archived
priority: critical
phase: "Phase 1: Remove consumers"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1968, type: blocks}
---
Estimate: M
Approach: add a boolean `--requires-uat` arg to `packages/lore/src/adapters/cli/commands/set.ts`; read the doc's current `extra` (`lore get` path / corpusService.get), merge `{requires_uat: true}` keeping every key, write the whole object through the existing corpusService.set path (gates + demotion unchanged). Non-plan doc → usage error exit 2 naming the flag. Rewrite the plan-promote feeding pack text in `packages/lore/src/service/checkpoint-registry.ts` (~:995-1008) to name `lore set <plan> --requires-uat` and drop every mention of the MCP `lore_set` tool.
Source: spec-remove-the-lore-mcp-server D2; existing flag pattern: set.ts spec_kind / decision_status handling (~:540/:595).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none (gate recovery depends on it)
Covers: AC-RMCP-4

Scenarios:
- Given a plan whose extra = {phases:[…]}, When `lore set <plan> --requires-uat`, Then exit 0, extra.requires_uat === true, extra.phases deep-equal to before.
- Given a plan already requires_uat, When re-run, Then exit 0 and extra unchanged (idempotent).
- Given a task doc, When `lore set <task> --requires-uat`, Then exit exactly 2 and stderr names --requires-uat; nothing written.
- Given a plan under a spec whose verification profile requires UAT and no requires_uat, When the plan-promote feeding pack renders, Then it contains `lore set <plan> --requires-uat` and does not contain `lore_set`.

Red-first: capture the failing tests before implementing, then capture the pass.

AC:
- `bun run test:file packages/lore/tests/integration/cli/set-requires-uat.bun.test.ts` exits 0 (AC-RMCP-4), red captured first.
- `bun run typecheck` exits 0.
- Use a throwaway corpus (mkdtemp + lore init), never the repo's .lore/.
