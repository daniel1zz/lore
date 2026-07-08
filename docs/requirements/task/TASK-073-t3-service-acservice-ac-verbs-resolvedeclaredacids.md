---
id: TASK-073
type: task
role: plan
title: "T3 service: AcService + ac verbs + resolveDeclaredAcIds port"
status: draft
priority: critical
phase: service-cli
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-018
plan: PLAN-018
links:
  - {id: TASK-070, type: blocks}
---
Objective: service-layer write orchestration + cross-entity validation for SPEC-038.
Spec: SPEC-038 §4, §6 (CLI half), §7 D4. ACs covered: AC-ACODE-2 (service paths), AC-ACODE-3 (validation), AC-ACODE-7.
Work:
1. NEW packages/lore/src/service/ac-service.ts — AcService (mirror phase-service.ts): addCriterion / listCriteria (+coverage via computeAcCoverage when a plan exists under the spec) / removeCriterion (reject when any task evidence ac_ref references the id; --force overrides). All Result<T, LoreError>.
2. packages/lore/src/service/corpus-service.ts — resolveDeclaredAcIds(planIdOrSlug): Promise<Result<Set<string> | null, LoreError>> read-only projection (plan → parent spec → extra.acceptance_criteria ids; null when spec absent or no structured ACs). Single graph-traversal locus (getPlanBundle family).
3. packages/lore/src/service/task-workflow-service.ts — addEvidence accepts ac_ref; validates via CONSTRUCTOR-INJECTED resolveDeclaredAcIds port (do NOT import CorpusService); undeclared id or no-structured-AC spec → VALIDATION_ERROR fail-loud. app.ts wires the port to CorpusService.
4. NEW packages/lore/src/adapters/cli/commands/ac.ts — lore ac add/list/rm (thin pipe onto AcService; exit codes per SPEC-003 conventions); register in CLI loader.
5. Tests: six-dimension, InMemoryStore + stubbed port; STATE dimension: rm --force leaves dangling ac_ref visible in list output.
Oracle: bun run typecheck + both test runners (affected files).
Depends: T1. File anchors: packages/lore/src/service/ac-service.ts (new), corpus-service.ts, task-workflow-service.ts, packages/lore/src/app.ts, packages/lore/src/adapters/cli/commands/ac.ts (new), CLI loader/registry file, matching tests. No overlap with T2 anchors.
