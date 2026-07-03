---
id: TASK-039
type: task
role: plan
title: "Restore confirm gate + version-not-found contract + delete no-confirm rejection test (AC-DH-11/12)"
status: archived
priority: high
phase: hardening
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, round-2]
parent: PLAN-008
plan: PLAN-008
links:
  - {id: TASK-037, type: blocks}
---
Files: packages/lore/src/adapters/http/dashboard-routes.ts (restore route: require confirm=true like delete; explicit tested contract for nonexistent version), its test file, packages/dashboard/src/api/mutations.ts (apiRestoreVersion sends confirm), packages/dashboard/src/components/HistoryTab.tsx if UI must pass confirm, mutations.test.ts. Add server regression test: DELETE without confirm=true rejected.
