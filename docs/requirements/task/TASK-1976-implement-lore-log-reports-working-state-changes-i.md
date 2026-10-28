---
id: TASK-1976
type: task
role: plan
title: "[implement] lore log reports working-state changes it does not show (CLI, HTTP)"
status: approved
priority: medium
phase: "Phase 3: Readers"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-258
plan: PLAN-258
links:
  - {id: TASK-2067, type: blocks}
---
Estimate: M
Approach: per spec Scope 6 (span by details.new_version).
Source: version-service.ts log; CLI log.ts (no --offset today, :52); HTTP log route (routes.ts) and dashboard consumers.
Covers: AC-HC-5

## Work
- VersionService.log returns `{ entries: VersionEntry[], state_changes_not_shown: number }` (was VersionEntry[]). Update every consumer: CLI log.ts, HTTP route (data becomes the object), packages/dashboard/src/lib/api.ts and components/HistoryTab.tsx, and their tests (tests/unit/adapters/http/routes.test.ts, tests/unit/service/version-slug.test.ts).
- Add `--offset` to the CLI (AC-HC-5 pages with it).
- Human output: closing line only when N > 0.

## AC
- AC-HC-5 command passes, red first; the dashboard typecheck (`bun run typecheck`) exits 0.
