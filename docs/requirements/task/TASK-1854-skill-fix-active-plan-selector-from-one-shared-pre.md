---
id: TASK-1854
type: task
role: plan
title: "[Skill:fix] Active-plan selector from one shared predicate; ready-list badge says done for archived tasks"
status: archived
priority: medium
phase: "P1"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-236
plan: PLAN-236
---
Implements plan-dashboard-read-surface-defects-plan-selector-ready-list (read it: `lore get` the plan; it has the full defect evidence and design). Governing spec: spec-077-dashboard-execution-read-surface-prd-21-f3 S1/S2, AC-077-1 (unchanged).

## Done means
1. One named predicate in `@lore/core` (browser-safe, no Node import) for "active plan" = plan whose status is neither archived nor deprecated. `SessionService` bootstrap (`packages/lore/src/service/session-service.ts`, the `plan.status === "archived" || "deprecated"` skip) calls it instead of its inline comparison.
2. The HTTP docs list (`GET /api/docs`, packages/lore/src/adapters/http/routes.ts) accepts a named filter `active=true` (valid with `type=plan`; refuse it with VALIDATION_ERROR for other types) that applies the same predicate. Find the existing query-param parsing and follow its pattern.
3. The dashboard's two queries (`packages/dashboard/src/components/ExecutionPage.tsx:82`, `ActivePlansPanel.tsx:87`) request `{ type: "plan", active: true }` instead of `status: "active"`; extend `apiList`'s params type accordingly.
4. `ReadyTaskList.tsx:125`: badge derives from the task status first — archived → "done"; otherwise "ready"/"blocked" from `ready`. Still one row per record.

## Oracles (red first: record `--result expected-fail`, then green)
- `packages/lore/tests/integration/http/active-plan-filter.test.ts`: throwaway corpus (mkdtemp + lore init) with plans in draft, approved, archived, deprecated; `GET /api/docs?type=plan&active=true` returns exactly the draft+approved ones and equals `lore bootstrap --json` `active_plans` slugs for the same corpus; `active=true` with `type=spec` → 4xx VALIDATION_ERROR.
- Dashboard component tests (jsdom, existing pattern under packages/dashboard/tests or src/**/__tests__ — follow what ReadyTaskList/ExecutionPage tests already use): ReadyTaskList with one archived (ready:false) and one draft (ready:true) record renders two rows badged "done" and "ready"; ExecutionPage's selector lists a plan returned by the active filter (mock the api layer the way existing tests do).
Record each with `lore evidence <task> --oracle test --result pass --capture --command "<exact command>"`; tsc via `--oracle tsc --capture --result pass --command "bun run typecheck"`.

## Notes
- Another session is working dashboard HR-T6 (Needs-you page); if a file you need shows a recent foreign change, merge main first and keep their change.
- The dashboard must not import `@lore/lore` or Node builtins (packages/dashboard/CLAUDE.md).
