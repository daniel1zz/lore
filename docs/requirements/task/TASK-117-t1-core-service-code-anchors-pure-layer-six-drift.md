---
id: TASK-117
type: task
role: plan
title: "T1 core + service — code-anchors pure layer (six drift kinds), DriftCheckService (FsProbe port, CAS RMW), CorpusService grammar seams, config"
status: archived
priority: high
created: 2026-07-12
updated: 2026-07-12
tags: [spec-045, t1]
parent: PLAN-029
plan: PLAN-029
links:
  - {id: TASK-116, type: blocks}
---
Implements SPEC-045 D1-D4, D6 (service half), D6a, D8, D9 → ACs AC-DR-1,2,3,7,8. Deliverables: packages/core/src/code-anchors.ts (parseCodeAnchor per-entry on FULL raw string then normalizeFileAnchors on path part — NEVER batched normalize over extracted paths; scanExportedSymbols line-anchored D3 forms; computeDrift with six kinds file_missing|dir_missing|dir_empty|symbol_missing|node_type_mismatch|probe_error, consistent ONLY when every anchor affirmatively verifies); specExtraSchema.code_anchors z.array(z.string()) shape-only; DriftCheckService (packages/lore/src/service/drift-check-service.ts): FsProbe port {stat, readFile, listDir} with EVERY probe call individually wrapped (thrown error -> probe_error row, scan continues), listDir immediate children with dotfiles EXCLUDED from emptiness count, findMany({type:'spec'}) load, per-unique-path probe dedup, addCodeAnchors/removeCodeAnchors incremental CAS RMW (expected_version, CONFLICT on race) preserving all sibling extra keys, plus setCodeAnchors declarative REPLACE for the MCP path; CorpusService D6a seams: _createImpl type==='spec' branch + set() grammar re-validation for extra.code_anchors (mirror task file_anchors branch); task-anchor authoring seams (TaskWorkflowService add/set) reject entries containing '#' loud naming the spec grammar; config workflow.drift.enabled boolean default true strict-Zod. @lore/core default barrel stays browser-safe (no fs). Oracles: AC-named vitest files + bun run typecheck + full suites. ABSOLUTE worktree paths; checkpoint-commit after each coherent unit.
