---
id: TASK-1608
type: task
role: plan
title: "G2 read-only paths record no outcome; check-stats uses the plan-membership predicate"
status: approved
priority: medium
phase: "G"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Main green, group B1 and B2: D2's outcome recording made read-only paths write state.

- B1: setup-project-check expects `lore setup --project --check` to write only .lore/.lore-project-check.json, but it now also writes lore.db-wal. session-trail-runs expects no check-outcomes.jsonl. Fix it at the root: a read-only command records no outcome rows in lore.db. A hook whose payload has no session_id writes no outcome line.
- B2: check-plan-membership-sites flags packages/lore/src/service/check-stats-service.ts:237 with rule plan-scope-on-parent-id-proxy. Use the canonical plan-membership predicate instead of parent_id.

Oracle: setup-project-check, session-trail-runs, check-plan-membership-sites, check-stats and the hooks unit tests pass, unfiltered.
