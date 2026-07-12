---
id: TASK-115
type: task
role: plan
title: "T1 core + store + services — staleness pure layer, migration-005, kind store contract, StalenessProbeService, probeStaleness, ValidityService calibration port"
status: archived
priority: high
created: 2026-07-12
updated: 2026-07-12
tags: [spec-044, t1]
parent: PLAN-028
plan: PLAN-028
links:
  - {id: TASK-114, type: blocks}
---
Implements SPEC-044 D1-D5, D8, D12, D13, D15 → ACs AC-SP-1,2,3,4,9,10,11. Deliverables: packages/core/src/staleness.ts (selectProbeCandidates, computeStalenessPriority, staleness verdict Zod schema incl. superseded_candidate {ref, reason<=200}); reviewJudgmentSchema gains kind ('review'|'staleness', default review) + optional superseded_candidate, kind-conditioned no-reject refinement ORDERED BEFORE escalate-invariant; migration-005.ts (kind TEXT NOT NULL DEFAULT 'review' + superseded_candidate JSON, idempotent re-run); StoreInterface: countLinksByToIds(toIds) all-link-types batch, latestJudgmentsByDocIds(docIds, kind) batch, kind param on latestJudgment/findJudgments (undefined stored kind reads as 'review' via ??) — implemented in SQLiteStore, TursoStore, InMemoryStore; JudgmentService latestFor/listFor default kind='review'; StalenessProbeService (batch orchestration, ONE call per batch method, audit action staleness_probe actor=by excluded from VERSION_ACTION_AUDIT_FAMILY, doc never mutated); AIProviderService.probeStaleness + staleness-template.ts (STALENESS_PROMPT_VERSION v1, char budgets, neighbor cap with loud '+n more', one corrective retry, doc_version at bundle-assembly); ValidityService optional stalenessCalibration port (bare construction unwired); computeCalibrationStats group key gains joined kind; config ai.staleness.{max_doc_chars:12000, neighbor_limit:20} + workflow.staleness.{default_limit:5, min_age_days:14} strict-Zod. Oracles: bunx vitest run for the AC-named test files + bun run typecheck. ABSOLUTE worktree paths for every oracle invocation.
