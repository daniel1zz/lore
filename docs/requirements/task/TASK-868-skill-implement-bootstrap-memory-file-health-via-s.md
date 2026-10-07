---
id: TASK-868
type: task
role: plan
title: "[Skill:implement] bootstrap memory_file_health via shared adapter helper"
status: archived
priority: medium
phase: "Phase 2: Surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-880, type: blocks}
---
Estimate: M
Approach: per spec-claude-md-root-section-structure-check-and-adoption-mode D8/D9 — new adapters/cli/memory-file-health.ts: resolve budgets from the config bootstrap already loads, probe ROOT entries via budgets.filenames (real-memory-file-probe.ts — IMPORT ONLY; if you find you must change it, stop and report instead of editing an unanchored file), dedupe by realpath, run runMemoryFileChecks, project to memory_file_health. Attach beside sessionService.bootstrap in commands/bootstrap.ts (SessionService stays fs-free). Extend core bootstrapReportSchema with the OPTIONAL field (else zod strips it silently). Render one text line for the session-start injection.
Source: spec-claude-md-root-section-structure-check-and-adoption-mode Public Interface; coupling review (bootstrap.ts ~L229/246, session.ts ~L719)
Dimensions: D-FUNC, D-CODE
Scope-Alt: text-line wording may change; JSON field is fixed.
Covers: AC-STR-5

AC:
- `cd packages/lore && bun test tests/integration/bootstrap-memory-file-health.bun.test.ts` passes.
- `bun run typecheck` exit 0; `bun run test:changed main` green PLUS by hand `cd packages/lore && bun test tests/integration/bootstrap-*.bun.test.ts`.
- Live call site: `lore bootstrap` (production) is what the test drives.
