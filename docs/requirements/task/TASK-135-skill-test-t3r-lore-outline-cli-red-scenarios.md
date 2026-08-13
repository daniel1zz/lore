---
id: TASK-135
type: task
role: plan
title: "[Skill:test] T3r lore outline CLI — RED scenarios"
status: archived
priority: critical
phase: "Phase 1: Core schemas & outline writer"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-134, type: blocks}
---
Estimate: S
Source: AC of task T3 (CLI surface)
TDD-Role: red | Paired-Impl: T3 CLI outline group

Scenarios:
- Given `lore outline set <prd> --section distribution --title X --tier domain --direction Y`, When run on a throwaway corpus, Then exit 0 and `lore outline list <prd>` shows the entry.
- Given `lore outline set` with unknown flag, Then exit 2 (strict-flag seam).
- Given `lore outline exempt <plan>` without --reason, Then exit 2.
- Given `lore outline exempt <plan> --reason "hotfix"`, Then exit 0 and plan extra carries prd_sync_exempt {reason, by, at}.
- Given `lore set <prd>` attempting an extra patch with outline key, Then exit 4 naming `lore outline`.

AC:
- All scenarios executable (bun test, packages/lore/tests/integration/cli-outline.bun.test.ts, throwaway corpus per global-setup pattern)
- Run → all RED for missing-implementation reasons only
