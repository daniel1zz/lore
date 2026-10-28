---
id: TASK-930
type: task
role: plan
title: "[Skill:implement] plan-close cascade uses the DoneFloorPort and set prints the cascade (#47)"
status: archived
priority: high
phase: "plan-close-floors"
created: 2026-10-12
updated: 2026-10-25
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-956, type: blocks}
  - {id: TASK-926, type: blocks}
---
Estimate: M
Approach: (1) CorpusService `cascadeArchiveOnPlanClose` (corpus-service.ts:3082): check each task target through the DoneFloorPort (wired by the previous task) before archiving it: `{floor}` → `skipped` with `floor` and the floor name as reason, task untouched; port err → `failed` with its message (D6); null → archive as today. Handoffs unchanged. Not switched off by `workflow.gates."plan-close".enabled: false`. Add `floor?: DoneFloor` to `PlanCloseCascadeResult.skipped` (and `PlanCloseCascadeSkip` in packages/core/src/archive-candidates.ts if the type is shared). (2) commands/set.ts human branch (:705-720): after a plan → archived write print `Cascade archived: <slug>` per archived doc and `Cascade skipped: <slug> (<floor or "fresh claim">)` per skip (D7); `--json` unchanged except `floor`. Run scoped: the three RED files, `bun run build` before the compiled e2e, `bun run typecheck`.
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on D6, D7; issue #47; facts corpus-service.ts:3061/:3082, set.ts:705-720, archive-candidates.ts computePlanCloseCascadeTargets.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-AP-4, AC-AP-5, AC-AP-6, AC-AP-8

AC:
- AC-AP-4, AC-AP-5 and AC-AP-6 commands print their PASS lines.
- `bun run typecheck` exits 0. Commit before attesting; stop at `lore release`.
