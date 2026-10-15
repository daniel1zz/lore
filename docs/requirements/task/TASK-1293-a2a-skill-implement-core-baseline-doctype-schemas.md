---
id: TASK-1293
type: task
role: plan
title: "[A2a] [Skill:implement] core: baseline DocType, schemas, rule types, lint, tree blueprint"
status: archived
priority: critical
phase: "Phase A: core contracts"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1291, type: blocks}
  - {id: TASK-1288, type: blocks}
  - {id: TASK-1287, type: blocks}
---
Estimate: M
Approach: per spec §C1 + §C3 lint; follow the typed-extra pattern of `packages/core/src/acceptance.ts` and the per-type superRefine in `schemas.ts`; new pure module `packages/core/src/baseline.ts` (types, Zod schema, lifecycle transition helper, `lintRuleStatement` with an injected `pathExists` predicate so core stays browser-safe — no Node import in the default barrel, see packages/core/src/CLAUDE.md).
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`).
Covers: AC-BLS1-7, AC-BLS1-9 (schema/lint half)
Scope-Alt: lint token kinds beyond the 6 listed may be deferred.

AC:
- `bunx vitest run packages/lore/tests/unit/core/baseline.test.ts -t "baseline schema and lint"` exit 0 AND its output contains `Tests  N passed` with N ≥ 7 and 0 failed (a -t filter matching nothing exits 0 with everything skipped — that is not a pass).
- `baseline.ts` exported from `packages/core/src/index.ts` (browser-safe barrel — no Node import).
- `bun run typecheck` exit 0.
- `DocType` includes `baseline`; `PARENT_TYPE_CONTRACT.baseline` and `DOC_TYPE_ROLE_MAP.baseline` set; `lore.tree.yaml` models prd → baseline → baseline.
