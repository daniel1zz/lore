---
id: TASK-1583
type: task
role: plan
title: "Web-API approve and reject record no reviewer, and web reject takes no reason"
status: deprecated
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-196
plan: PLAN-196
---
Owner decision 2026-10-18 (baseline restoration P4, knowledge-non-cli-entry-points-mapped-to-baseline-leaves-by): an approval or rejection must always say who decided. Today POST /api/review/:id/approve and /reject (packages/lore/src/adapters/http/routes.ts:653-660) record no reviewer; the bearer reject takes no reason, while CLI reject records the actor and --reason. (The dashboard routes record actor.owner ?? actor.name, dashboard-routes.ts:319.) Expected: every approve/reject entry records the authenticated actor as reviewer; reject over the web API accepts and stores a reason like the CLI. Leaf SYSV already carries Q1 on the missing reviewer.
