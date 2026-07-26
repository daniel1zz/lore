---
id: TASK-303
type: task
role: plan
title: "[Skill:implement] setup-render receipt renderer + test"
status: archived
priority: medium
phase: "cli-adapter"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-301, type: blocks}
---
Estimate: S
Approach: Implement `adapters/cli/setup-render.ts` — pure receipt renderer over the SetupService result + a vitest. Mirror assess-render.ts / review-render.ts split-for-testability precedent.
Source: SPEC-046 Design (adapters/cli/setup-render.ts, assess-render.ts precedent).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none.
Covers: AC-046-E (render coverage half)

AC:
- Given a SetupService receipt object (binary found?, N skills/agents/hooks written vs skipped, MCP registered ✓/skipped, manifest path, backup path), When renderSetupReceipt() runs, Then it returns a deterministic string containing each of those fields (assert substrings).
- Given a receipt where MCP was skipped (claude absent), When rendered, Then the output shows MCP as skipped AND surfaces the manual command line.
- Given a dry-run plan receipt, When rendered, Then it is clearly labeled as a plan (no writes performed).
- Six-dimension: HAPPY(full install)/NEGATIVE(MCP skipped)/BOUNDARY(all-skipped re-run)/ERROR(partial write reported)/STATE(written vs skipped counts)/REGRESSION(byte-stable format).
- Oracle: `bunx vitest run packages/lore/tests/unit/adapters/setup-render.test.ts` exits 0 (folded into AC-046-E full regression).
