---
id: TASK-634
type: task
role: plan
title: "[Skill:implement] FIX CorpusService.resolve duplicate — delegate to shared resolveDoc (ordinal-ref + SPEC-065 id-prefix)"
status: archived
priority: medium
phase: "Phase 3: Verification + live repair"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
---
T7 e2e uncovered: CorpusService has a private resolve() duplicate (16 call sites: get/set/delete/link/unlink/create-parent) never wired to resolve.ts::resolveDoc — missing BOTH the SPEC-084 parseOrdinalRef+findByTypeOrdinal step AND the SPEC-065 id-prefix fallback (explains handoff-29 observation #5: lore get on truncated id-prefix failed twice). Root-cause fix: kill the duplicate, delegate to the shared resolveDoc (SSOT). Oracle: packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts (currently 3/5, two RED pin this) + full ordinal-identity + corpus-service suites. Blocks T8 live repair.
