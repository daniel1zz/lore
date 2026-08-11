---
id: TASK-637
type: task
role: plan
title: "[Skill:implement] T5 export read-switch + SPEC-021 A1 retirement"
status: archived
priority: medium
phase: "Phase 2: Consumers (parallel)"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
links:
  - {id: TASK-641, type: blocks}
---
Estimate: M
Approach: per SPEC-084 "Export inverts". `ExportDocsService`: for numbered types, `human_id` = `formatDocDisplayId(doc)` (pure column read) and `file_path` derives from it; the SPEC-021 A1 title-parse + sequential-fallback + silent-renumber allocation path is RETIRED for numbered types (dead code removed, not flagged off) while non-numbered types keep the legacy path byte-identical. A numbered-type doc with NULL ordinal (pre-migration legacy) falls back to the legacy path with a LOUD report warning naming `lore migrate ordinals` — never a silent number invention. Existing export-index mappings for numbered docs are reconciled to the column on the next export run (report `repaired`-family entry, mirroring the existing repairCollisions loudness).
Source: SPEC-084 D-table "Export inverts" + export-docs-service.ts §SPEC-021 A1 block + repairCollisions precedent
Dimensions: D-FUNC, D-CODE
Scope-Alt: index-reconcile-on-export may be deferred to the T6 migration if double-implementation emerges — coordinate via evidence note
Covers: AC-084-6

AC:
- Existing export-docs vitest suites GREEN after adaptation (fixtures updated deliberately, changes enumerated in evidence output_tail — no silent fixture rewrites).
- New cases: numbered doc exports under column-derived human_id; NULL-ordinal numbered doc → legacy path + loud warning; non-numbered type byte-identical (REGRESSION).
- `bunx vitest run packages/lore/tests/unit/service/export-docs-service.test.ts` (or the file's actual path found at task start) GREEN; `bun run typecheck` exit 0.
