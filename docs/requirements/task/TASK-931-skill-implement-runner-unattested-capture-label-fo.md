---
id: TASK-931
type: task
role: plan
title: "[Skill:implement] runner-unattested capture label for the inconclusive green-control row (#48)"
status: archived
priority: high
phase: "capture-label"
created: 2026-10-12
updated: 2026-10-25
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-960, type: blocks}
  - {id: TASK-927, type: blocks}
---
Estimate: M
Approach: (1) packages/core/src/task-workflow.ts:163 `CAPTURE_SOURCES` gains `"runner-unattested"`; keep the field `.optional()` and the absent→self-report read rule. (2) verify-runner-service.ts:1917 green-control-failed row (and its launch-failure sibling, and the dependency-materialization inconclusive row) writes `capture_source: "runner-unattested"`, still no attestation (D1). (3) One shared helper refuses `runner-unattested` + `attestation` (VALIDATION_ERROR), called by BOTH `TaskWorkflowService.appendEvidenceEntry` and `phase-workflow-service.ts:729`; every `=== "runner"` reader stays as is (D2: task-workflow-service.ts :1043, :1647, :2404) — the attested-pass floor now lives in `checkDoneFloors` (extracted by Plan A's task-skill-implement-extract-checkdonefloors-and-wire-the, which blocks this task); confirm a runner-unattested pass never clears it. (4) commands/status.ts: `capture_source_runner_unattested_count` (JSON + `--enumerate` registry) so runner + self_report + runner_unattested = total; :738 becomes three buckets. (5) assess-render.ts, commands/assess.ts:447 and commands/verify.ts:559: render a distinct third label. Fix every exhaustive switch tsc reports; `lore anchor add` before editing any unlisted file. Re-baseline the pinned tests listed in the anchors. Run scoped: AC-EH-1/AC-EH-2 files, every test importing verify-runner-service.ts / task-workflow-service.ts / phase-workflow-service.ts / status.ts / assess-render.ts (hand-pick), `bun run typecheck`.
Source: spec-evidence-labels-and-reds-are-honest D1, D2; issue #48; facts verify-runner-service.ts:1910-1921, task-workflow.ts:163, status.ts:738/:920-925, assess.ts:447, verify.ts:559, phase-workflow-service.ts:729.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-EH-1, AC-EH-2, AC-EH-11

AC:
- AC-EH-1 and AC-EH-2 commands print their PASS lines.
- `bun run typecheck` exits 0. Commit before attesting; stop at `lore release`.
