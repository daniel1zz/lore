---
id: TASK-075
type: task
role: plan
title: "T1 core: acceptance schema + ORACLE_KINDS SSOT + ac_ref"
status: archived
priority: critical
phase: "core-schema"
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-018
plan: PLAN-018
links:
  - {id: TASK-074, type: blocks}
  - {id: TASK-073, type: blocks}
  - {id: TASK-072, type: blocks}
  - {id: TASK-071, type: blocks}
---
Objective: land the entire @lore/core layer of SPEC-038.
Spec: SPEC-038 §3, §4 (schema half), §7 D1-D3. ACs covered: AC-ACODE-1, AC-ACODE-2 (schema half), AC-ACODE-6, AC-ACODE-11.
Work:
1. NEW packages/core/src/acceptance.ts — AC_VERIFY_MODES, SCRIPT_ORACLES (explicit literal + type-level exhaustiveness assertion vs OracleKind), acceptanceCriterionSchema (id regex ^AC-[A-Z0-9]+(-[A-Z0-9]+)*$, statement ≤2000, verify discriminated union script/ai/human), specAcceptanceCriteriaSchema (max 50), computeAcCoverage(criteria, tasks) pure facts fn ({ac_id, mode, pass, fail, refs}). Browser-safe: no Node imports, no Date.now().
2. packages/core/src/task-workflow.ts — extract + export ORACLE_KINDS from evidenceEntrySchema inline enum; evidenceEntrySchema += ac_ref?: z.string() (optional, no format constraint here).
3. packages/core/src/schemas.ts — specExtraSchema += acceptance_criteria: specAcceptanceCriteriaSchema.optional(); superRefine unique ids; wire into createDocInputSchema spec branch (mirror spec_kind SPEC-032 precedent — validate on BOTH create and set validation surface used by CorpusService).
4. Tests (vitest, packages/core): six-dimension coverage per SPEC-038 §9 — duplicate id, bad regex, script-without-command, rubric overlong, 50-item boundary, empty array, coverage aggregation with/without ac_ref, empty task set, exhaustiveness of SCRIPT_ORACLES.
Oracle: bunx vitest run packages/core + bun run typecheck. Do NOT touch packages/lore in this task.
File anchors: packages/core/src/acceptance.ts (new), packages/core/src/task-workflow.ts, packages/core/src/schemas.ts, packages/core/src/index.ts (barrel export), packages/core tests.
