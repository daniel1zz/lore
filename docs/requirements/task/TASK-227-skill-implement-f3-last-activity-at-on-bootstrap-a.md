---
id: TASK-227
type: task
role: plan
title: "[Skill:implement] F3 — last_activity_at on bootstrap active_plans (core session schema + SessionService + formatter + fixtures)"
status: archived
priority: high
phase: "Phase 1: Implementation"
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: PLAN-051
plan: PLAN-051
links:
  - {id: TASK-230, type: blocks}
---
Estimate: M
Approach: Pure total fn deriveLastActivityAt(plan, tasks): string in packages/core/src/session.ts (sibling of deriveSessions; max ISO-string comparison over plan.updated_at + every task.updated_at — ISO-8601 UTC strings compare lexicographically). Add REQUIRED last_activity_at: z.string() to bootstrapActivePlanSchema AND the BootstrapReport TS shape (they must move together — z.object strips unknown keys at the bootstrapReportSchema.parse self-check). Populate in SessionService.bootstrap's existing activePlans loop (tasks already in memory — zero new store calls). CLI commands/bootstrap.ts formatBootstrapReport: render relative time via existing utils relativeTime. Migrate the four fixture files that construct active_plans entries: tests/unit/service/session-bootstrap.test.ts, session-bootstrap-batch.test.ts, session-registry.test.ts, tests/unit/adapters/mcp-session-tools.test.ts — introduce/extend a shared makeActivePlan()-style factory where the files already share helpers, else per-file mechanical addition. Verify MCP lore_bootstrap passes the report through without reshaping (if it reshapes, thread the field; note finding in completion report).
Source: spec-069 Design Decisions D6/D7 + Module Boundary TS signatures
Dimensions: D-FUNC, D-CODE
Scope-Alt: relative-time rendering in the text formatter may fall back to raw ISO if relativeTime util does not fit (JSON surface is the load-bearing one)
Covers: AC-069-6

AC:
- deriveLastActivityAt with zero tasks returns plan.updated_at (totality); with tasks returns the max across plan+tasks (BOUNDARY: task newer than plan, plan newest, ties)
- SessionService.bootstrap: every active_plans entry carries last_activity_at and the value equals the known max of the seeded fixture docs
- bootstrapReportSchema.parse throws on an active_plans entry missing last_activity_at (fail-loud NEGATIVE)
- Existing bootstrap-related suites pass after fixture migration (REGRESSION: no other field changed)
- Scoped oracles green in worktree: bunx vitest run packages/lore/tests/unit/service/session-bootstrap-last-activity.test.ts packages/lore/tests/unit/service/session-bootstrap.test.ts packages/lore/tests/unit/service/session-bootstrap-batch.test.ts packages/lore/tests/unit/service/session-registry.test.ts packages/lore/tests/unit/adapters/mcp-session-tools.test.ts (assert matched count == 5) + bun run typecheck
