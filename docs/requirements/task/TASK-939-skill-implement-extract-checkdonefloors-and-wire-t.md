---
id: TASK-939
type: task
role: plan
title: "[Skill:implement] extract checkDoneFloors and wire the DoneFloorPort (#47)"
status: archived
priority: high
phase: "plan-close-floors"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-930, type: blocks}
  - {id: TASK-956, type: blocks}
  - {id: TASK-931, type: blocks}
---
Estimate: M
Approach: (1) TaskWorkflowService (task-workflow-service.ts): extract the four floors of `_doneImpl` (:3318 — attested pass, red-first, no-new-tests, unfiltered test-file run, in that order) into public `checkDoneFloors(taskIdOrSlug)` returning `{ floor, error }` or null, where `error` is EXACTLY the LoreError `_doneImpl` returns today plus `details.floor` (D5). `_doneImpl` calls it and returns that error unchanged. The `--override-attestation` branches (:3355-3376) stay inside `_doneImpl` and are evaluated where they are today. (2) CorpusService (corpus-service.ts): declare `DoneFloor` / `DoneFloorPort` structurally and add `setDoneFloorPort(port)` (no caller inside CorpusService yet — the cascade and sweep consume it in the next tasks). (3) app.ts: `corpusService.setDoneFloorPort({ checkDoneFloors: (id) => taskWorkflowService.checkDoneFloors(id) })` at both CorpusService sites (:713, :1103). Run scoped: check-done-floors.test.ts, every existing `lore done` floor test (`grep -rlE 'override-attestation|red_first|no-new-tests|unfiltered' packages/lore/tests` intersected with done usage — hand-pick), `bun run typecheck`.
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on D5; issue #47; facts task-workflow-service.ts:3304/:3318/:3355-3376.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-AP-7, AC-AP-8, AC-AP-9

AC:
- AC-AP-9's command prints its PASS line; existing done-floor tests unchanged and green.
- AC-AP-7's command prints `AC-AP-7 PASS: 2 CorpusService composition sites ...` (both ports wired; IMPL-1 merged first).
- `bun run typecheck` exits 0. Commit before attesting; stop at `lore release`.
