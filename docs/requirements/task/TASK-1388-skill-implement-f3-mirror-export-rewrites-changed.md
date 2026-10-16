---
id: TASK-1388
type: task
role: plan
title: "[Skill:implement] F3 mirror: export rewrites changed bodies; check counts frontmatter drift"
status: archived
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1381, type: blocks}
---
Estimate: M
Approach: per spec F3 — the mirror directories are a projection: the mirror script passes ExportDocsService's body-overwrite option (the --force equivalent) for the mirror directories; lore export-docs keeps SPEC-021 A2 (body overwritten only with --force), so export-docs-service.test.ts:721,758 and mirror-frontmatter-drift.test.ts:420 stay green unchanged; computeMirrorContentDrift counts frontmatter_repaired and frontmatter_declined as drift.
Source: spec F3; packages/lore/src/service/export-docs-service.ts:631-664; scripts/export-spec-mirror.ts:45-47, 318-345; scripts/export-spec-mirror-core.ts:277-278
Resolves: task-the-two-mirror-exporters-disagree-bun-run-mirror-export, task-mirror-export-never-rewrites-an-existing-file-whose; also task-the-mirror-export-silently-skips-a-changed-knowledge-doc
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CRIT-4, AC-CRIT-5
AC:
- Given a throwaway corpus with exported spec + knowledge doc, When their bodies change and the export runs with no flags, Then both mirror files carry the new body and --check exits 0; lore export-docs without --force still leaves a changed body untouched (AC-CRIT-4)
- Given only a status change, When --check runs before export, Then it exits exactly 2 naming the file (AC-CRIT-5)
- Update the script header comment (export-spec-mirror.ts:45-47) that says body drift needs --force; grep for that wording returns nothing.
Integration: bun run mirror:export and bun run check:spec-mirror (package.json) are the production entry points; the test drives main() of the same script. Do NOT run mirror:export against this repo's corpus from a worktree.
